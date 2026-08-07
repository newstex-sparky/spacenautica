/**
 * offlineStore.ts
 *
 * IndexedDB-backed offline save store for Spacenautica.
 *
 * localStorage is limited (~5MB) and synchronous. IndexedDB can hold much
 * larger payloads and is the standard durable offline store in browsers.
 * This module persists the latest serialized save snapshot so the game can
 * be resumed even when the D1 cloud endpoint is unreachable.
 *
 * Pure and self-contained: it uses the Web-standard IndexedDB API with an
 * injectable IDBFactory so it is testable with fake-indexeddb.
 */

// Default database / object-store names for the offline save snapshot store.
export const OFFLINE_DB_NAME = 'spacenautica-offline';
export const OFFLINE_STORE_NAME = 'saves';

/** A single offline save snapshot stored in IndexedDB. */
export interface OfflineSaveRecord {
  /** Stable game id (matches the D1 /api/games id). */
  gameId: string;
  /** Persistence slot number (1-based). */
  slot: number;
  /** Serialized snapshot string (the localStorage-compatible JSON). */
  payload: string;
  /** Save format version emitted by serializeGameState. */
  version: string;
  /** Wall-clock ms epoch when the snapshot was written. */
  timestamp: number;
}

export interface OfflineStoreOptions {
  /** IndexedDB database name. Defaults to OFFLINE_DB_NAME. */
  dbName?: string;
  /** Object store name. Defaults to OFFLINE_STORE_NAME. */
  storeName?: string;
  /** Injectable IDBFactory for testing. Defaults to globalThis.indexedDB. */
  indexedDB?: IDBFactory;
}

/** A connected handle to the offline IndexedDB store. */
export interface OfflineStore {
  /** The underlying IDBDatabase connection. */
  db: IDBDatabase;
  /** Object store name in use. */
  storeName: string;
  /** Close the connection. */
  close(): void;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Open (and create if needed) the offline IndexedDB store.
 *
 * Throws if IndexedDB is unavailable (e.g. private browsing mode that
 * disables it) so callers can fall back to localStorage.
 */
export async function openOfflineStore(
  options: OfflineStoreOptions = {},
): Promise<OfflineStore> {
  const idb = options.indexedDB ?? globalThis.indexedDB;
  if (!idb) {
    throw new Error('IndexedDB is not available in this environment');
  }
  const dbName = options.dbName ?? OFFLINE_DB_NAME;
  const storeName = options.storeName ?? OFFLINE_STORE_NAME;

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'gameId' });
        // Index by slot so we can list all saves for a persistence slot.
        store.createIndex('slot', 'slot', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
  });

  return {
    db,
    storeName,
    close() {
      db.close();
    },
  };
}

function tx(store: OfflineStore, mode: IDBTransactionMode): IDBObjectStore {
  return store.db.transaction(store.storeName, mode).objectStore(store.storeName);
}

/**
 * Upsert a save snapshot into the offline store. Keyed by gameId, so writing
 * a newer snapshot for the same game replaces the older one.
 */
export async function putOfflineSave(
  store: OfflineStore,
  record: OfflineSaveRecord,
): Promise<void> {
  await promisifyRequest(tx(store, 'readwrite').put(record));
}

/** Read a single save snapshot by gameId. Resolves undefined when absent. */
export async function getOfflineSave(
  store: OfflineStore,
  gameId: string,
): Promise<OfflineSaveRecord | undefined> {
  const result = await promisifyRequest(tx(store, 'readonly').get(gameId));
  return result as OfflineSaveRecord | undefined;
}

/** List all save snapshots, newest first. */
export async function listOfflineSaves(
  store: OfflineStore,
): Promise<OfflineSaveRecord[]> {
  const all = await promisifyRequest(tx(store, 'readonly').getAll());
  const records = (all as OfflineSaveRecord[]).slice();
  records.sort((a, b) => b.timestamp - a.timestamp);
  return records;
}

/** Delete a save snapshot by gameId. */
export async function deleteOfflineSave(
  store: OfflineStore,
  gameId: string,
): Promise<void> {
  await promisifyRequest(tx(store, 'readwrite').delete(gameId));
}

/** Delete every save snapshot in the store. */
export async function clearOfflineSaves(store: OfflineStore): Promise<void> {
  await promisifyRequest(tx(store, 'readwrite').clear());
}
