import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual } from 'node:assert';
import 'fake-indexeddb/auto';

import {
  OFFLINE_DB_NAME,
  OFFLINE_STORE_NAME,
  openOfflineStore,
  putOfflineSave,
  getOfflineSave,
  listOfflineSaves,
  deleteOfflineSave,
  clearOfflineSaves,
  type OfflineSaveRecord,
} from '../src/systems/offlineStore.ts';
import {
  createRetryQueue,
  type QueuedSave,
} from '../src/systems/retryQueue.ts';

// ─── Offline store (IndexedDB adapter) ────────────────────────────────────

function makeRecord(overrides: Partial<OfflineSaveRecord> = {}): OfflineSaveRecord {
  return {
    gameId: 'game-1',
    slot: 1,
    payload: '{"version":"0.3.0","timestamp":1}',
    version: '0.3.0',
    timestamp: 1000,
    ...overrides,
  };
}

test('openOfflineStore creates the database and object store', async () => {
  const store = await openOfflineStore();
  try {
    strictEqual(store.storeName, OFFLINE_STORE_NAME);
    ok(store.db.objectStoreNames.contains(OFFLINE_STORE_NAME));
  } finally {
    store.close();
  }
});

test('putOfflineSave then getOfflineSave roundtrips a record', async () => {
  const store = await openOfflineStore();
  try {
    const record = makeRecord();
    await putOfflineSave(store, record);
    const got = await getOfflineSave(store, 'game-1');
    deepStrictEqual(got, record);
  } finally {
    store.close();
  }
});

test('getOfflineSave resolves undefined for a missing gameId', async () => {
  const store = await openOfflineStore();
  try {
    const got = await getOfflineSave(store, 'does-not-exist');
    strictEqual(got, undefined);
  } finally {
    store.close();
  }
});

test('putOfflineSave upserts by gameId (newer snapshot replaces older)', async () => {
  const store = await openOfflineStore();
  try {
    await putOfflineSave(store, makeRecord({ timestamp: 1000, payload: 'old' }));
    await putOfflineSave(store, makeRecord({ timestamp: 2000, payload: 'new' }));
    const got = await getOfflineSave(store, 'game-1');
    strictEqual(got?.payload, 'new');
    strictEqual(got?.timestamp, 2000);
  } finally {
    store.close();
  }
});

test('listOfflineSaves returns all records newest first', async () => {
  const store = await openOfflineStore();
  try {
    await clearOfflineSaves(store);
    await putOfflineSave(store, makeRecord({ gameId: 'a', timestamp: 100 }));
    await putOfflineSave(store, makeRecord({ gameId: 'b', timestamp: 300 }));
    await putOfflineSave(store, makeRecord({ gameId: 'c', timestamp: 200 }));
    const all = await listOfflineSaves(store);
    deepStrictEqual(all.map((r) => r.gameId), ['b', 'c', 'a']);
  } finally {
    store.close();
  }
});

test('deleteOfflineSave removes a single record', async () => {
  const store = await openOfflineStore();
  try {
    await putOfflineSave(store, makeRecord({ gameId: 'a' }));
    await putOfflineSave(store, makeRecord({ gameId: 'b' }));
    await deleteOfflineSave(store, 'a');
    strictEqual(await getOfflineSave(store, 'a'), undefined);
    ok(await getOfflineSave(store, 'b'));
  } finally {
    store.close();
  }
});

test('clearOfflineSaves empties the store', async () => {
  const store = await openOfflineStore();
  try {
    await putOfflineSave(store, makeRecord({ gameId: 'a' }));
    await putOfflineSave(store, makeRecord({ gameId: 'b' }));
    await clearOfflineSaves(store);
    deepStrictEqual(await listOfflineSaves(store), []);
  } finally {
    store.close();
  }
});

test('openOfflineStore throws when IndexedDB is unavailable', async () => {
  const original = (globalThis as Record<string, unknown>).indexedDB;
  (globalThis as Record<string, unknown>).indexedDB = undefined;
  let rejected = false;
  try {
    await openOfflineStore();
  } catch {
    rejected = true;
  } finally {
    (globalThis as Record<string, unknown>).indexedDB = original;
  }
  ok(rejected, 'expected openOfflineStore to reject without IndexedDB');
});

// ─── Retry queue ──────────────────────────────────────────────────────────

function makeQueued(overrides: Partial<QueuedSave> = {}): Omit<QueuedSave, 'id' | 'enqueuedAt' | 'attempts'> {
  return {
    gameId: 'game-1',
    slot: 1,
    data: 'base64payload',
    version: '0.3.0',
    ...overrides,
  };
}

test('createRetryQueue starts empty', () => {
  const q = createRetryQueue();
  strictEqual(q.size(), 0);
  deepStrictEqual(q.pending(), []);
});

test('enqueue adds a save with id, enqueuedAt, and zero attempts', () => {
  const q = createRetryQueue({ now: () => 5000 });
  const record = q.enqueue(makeQueued());
  strictEqual(q.size(), 1);
  strictEqual(record.enqueuedAt, 5000);
  strictEqual(record.attempts, 0);
  ok(typeof record.id === 'string' && record.id.length > 0);
});

test('flush replays successful saves and removes them', async () => {
  const q = createRetryQueue();
  q.enqueue(makeQueued({ gameId: 'a' }));
  q.enqueue(makeQueued({ gameId: 'b' }));
  const sent: string[] = [];
  const replayed = await q.flush(async (save) => {
    sent.push(save.gameId);
    return true;
  });
  strictEqual(replayed, 2);
  strictEqual(q.size(), 0);
  deepStrictEqual(sent, ['a', 'b']);
});

test('flush keeps failed saves and increments attempts', async () => {
  const q = createRetryQueue();
  q.enqueue(makeQueued({ gameId: 'a' }));
  const replayed = await q.flush(async () => false);
  strictEqual(replayed, 0);
  strictEqual(q.size(), 1);
  strictEqual(q.pending()[0].attempts, 1);
});

test('flush drops a save once attempts reach maxAttempts', async () => {
  const q = createRetryQueue({ maxAttempts: 2 });
  q.enqueue(makeQueued({ gameId: 'a' }));
  await q.flush(async () => false); // attempts -> 1
  strictEqual(q.size(), 1);
  await q.flush(async () => false); // attempts -> 2, dropped
  strictEqual(q.size(), 0);
});

test('flush tolerates a throwing send callback', async () => {
  const q = createRetryQueue();
  q.enqueue(makeQueued({ gameId: 'a' }));
  const replayed = await q.flush(async () => {
    throw new Error('network down');
  });
  strictEqual(replayed, 0);
  strictEqual(q.size(), 1);
  strictEqual(q.pending()[0].attempts, 1);
});

test('remove deletes a specific queued save by id', () => {
  const q = createRetryQueue();
  const a = q.enqueue(makeQueued({ gameId: 'a' }));
  q.enqueue(makeQueued({ gameId: 'b' }));
  q.remove(a.id);
  strictEqual(q.size(), 1);
  strictEqual(q.pending()[0].gameId, 'b');
});

test('clear empties the queue', () => {
  const q = createRetryQueue();
  q.enqueue(makeQueued());
  q.enqueue(makeQueued());
  q.clear();
  strictEqual(q.size(), 0);
});

test('flush returns 0 when the queue is empty', async () => {
  const q = createRetryQueue();
  strictEqual(await q.flush(async () => true), 0);
});
