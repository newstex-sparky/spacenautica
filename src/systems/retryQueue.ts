/**
 * retryQueue.ts
 *
 * Offline retry queue for Spacenautica saves.
 *
 * When a save to the D1 cloud endpoint fails (offline, server down, transient
 * error), the failed request is enqueued locally. The queue replays pending
 * saves later — on demand, on a timer, or when connectivity returns — so no
 * progress is lost while offline.
 *
 * Pure and self-contained. Persistence is injected (IndexedDB or localStorage)
 * so the queue logic is testable without a browser.
 */

/** A queued save operation awaiting replay. */
export interface QueuedSave {
  /** Stable unique id for this queued operation. */
  id: string;
  /** The game id the save belongs to. */
  gameId: string;
  /** Persistence slot number (1-based). */
  slot: number;
  /** The serialized save payload (gzip+json base64) to POST. */
  data: string;
  /** Save format version. */
  version: string;
  /** Wall-clock ms epoch when the operation was first enqueued. */
  enqueuedAt: number;
  /** Number of replay attempts so far. */
  attempts: number;
}

export interface RetryQueueOptions {
  /** Maximum replay attempts before a queued save is dropped. Default 5. */
  maxAttempts?: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

export interface RetryQueue {
  /** Enqueue a save operation for later replay. */
  enqueue(save: Omit<QueuedSave, 'id' | 'enqueuedAt' | 'attempts'>): QueuedSave;
  /** All queued saves, oldest first. */
  pending(): QueuedSave[];
  /** Number of queued saves. */
  size(): number;
  /**
   * Replay all pending saves. Each is passed to `send`; on success it is
   * removed, on failure its attempt count increments (and it is dropped once
   * attempts exceed maxAttempts). Returns the number of saves successfully
   * replayed.
   */
  flush(send: (save: QueuedSave) => Promise<boolean>): Promise<number>;
  /** Remove a specific queued save by id. */
  remove(id: string): void;
  /** Remove every queued save. */
  clear(): void;
}

/**
 * Create a retry queue backed by an in-memory array. Callers persist the
 * queue (e.g. to IndexedDB) by reading `pending()` and restoring via
 * `enqueue` on startup.
 */
export function createRetryQueue(options: RetryQueueOptions = {}): RetryQueue {
  const maxAttempts = options.maxAttempts ?? 5;
  const now = options.now ?? (() => Date.now());
  const items: QueuedSave[] = [];

  function enqueue(
    save: Omit<QueuedSave, 'id' | 'enqueuedAt' | 'attempts'>,
  ): QueuedSave {
    const record: QueuedSave = {
      ...save,
      id: generateQueueId(now),
      enqueuedAt: now(),
      attempts: 0,
    };
    items.push(record);
    return record;
  }

  function pending(): QueuedSave[] {
    return items.slice();
  }

  function size(): number {
    return items.length;
  }

  async function flush(
    send: (save: QueuedSave) => Promise<boolean>,
  ): Promise<number> {
    let replayed = 0;
    // Iterate over a snapshot so removals during iteration are safe.
    for (const save of items.slice()) {
      let ok = false;
      try {
        ok = await send(save);
      } catch {
        ok = false;
      }
      if (ok) {
        const idx = items.findIndex((i) => i.id === save.id);
        if (idx >= 0) items.splice(idx, 1);
        replayed += 1;
      } else {
        const idx = items.findIndex((i) => i.id === save.id);
        if (idx >= 0) {
          items[idx].attempts += 1;
          if (items[idx].attempts >= maxAttempts) {
            items.splice(idx, 1);
          }
        }
      }
    }
    return replayed;
  }

  function remove(id: string): void {
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) items.splice(idx, 1);
  }

  function clear(): void {
    items.length = 0;
  }

  return { enqueue, pending, size, flush, remove, clear };
}

function generateQueueId(now: () => number): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `q-${rand}`;
}
