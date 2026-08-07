/**
 * saveSystem.ts
 *
 * Save serialization pipeline for Spacenautica.
 *
 * GameState -> JSON -> gzip -> base64 -> POST /api/games (Cloudflare D1).
 *
 * This module is pure and self-contained. It uses the Web-standard
 * CompressionStream / DecompressionStream APIs, which are available in both
 * modern browsers and Node.js >= 18, so the exact same serialization code runs
 * on the client and is testable with the Node test runner.
 */

// Version of the current save format. Matches the version emitted by
// Survival3D's buildSaveData and checked by App.loadGame.
export const SAVE_VERSION = '0.3.0';

// Wire format identifier used by the D1 /api/games worker.
export const SAVE_FORMAT = 'gzip+json';

// Autosave cadence in game-seconds. This counts simulated play time, not
// wall-clock time, so it pauses with the game and ignores tab-switch gaps.
export const AUTOSAVE_GAME_SECONDS = 60;

// Autosave interval in wall-clock milliseconds used before the game loop is
// running (or as a fallback when no live game-seconds ticker exists yet).
export const AUTOSAVE_FALLBACK_MS = 30000;

/**
 * Stateful autosave accumulator. It counts "game-seconds" (simulated time fed
 * by the game loop) and fires a callback once the accumulated time reaches
 * AUTOSAVE_GAME_SECONDS, then resets.
 */
export interface AutosaveTimer {
  /** Accumulated game-seconds since the last save. */
  elapsed: number;
  /**
   * Advance the timer by a game-loop delta (seconds). Returns true exactly when
   * the timer crosses the AUTOSAVE_GAME_SECONDS threshold and resets.
   */
  tick(dt: number): boolean;
  /** Reset accumulated time (e.g. after a manual save). */
  reset(): void;
}

export function createAutosaveTimer(
  intervalSeconds: number = AUTOSAVE_GAME_SECONDS,
): AutosaveTimer {
  let elapsed = 0;
  return {
    get elapsed() {
      return elapsed;
    },
    tick(dt: number): boolean {
      // Ignore invalid or negative deltas; a zero delta can never cross.
      if (!Number.isFinite(dt) || dt <= 0) return false;
      elapsed += dt;
      if (elapsed >= intervalSeconds) {
        elapsed = 0;
        return true;
      }
      return false;
    },
    reset() {
      elapsed = 0;
    },
  };
}

export interface SaveRequestOptions {
  /** Stable unique id for this save file. Omit to generate one. */
  gameId?: string;
  /** Persistence slot number (1-based). Defaults to 1. */
  slot?: number;
  /** Optional endpoint override. Defaults to '/api/games'. */
  endpoint?: string;
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
}

export interface CompressedGameState {
  /** base64-encoded gzip payload (the value sent as `data`). */
  base64: string;
  /** Byte length of the uncompressed JSON. */
  jsonBytes: number;
  /** Byte length of the gzip-compressed payload. */
  gzipBytes: number;
}

/**
 * Convert a GameState object to a JSON string.
 * Adds a timestamp so each save is distinguishable server-side.
 */
export function serializeGameState(gameState: unknown): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    timestamp: Date.now(),
    gameState,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  // `btoa` is a global in browsers and Node.js >= 16.
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * gzip-compress a JSON string and return it as a base64 string.
 */
export async function gzipCompress(json: string): Promise<string> {
  const encoder = new TextEncoder();
  const stream = new Blob([encoder.encode(json)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return bytesToBase64(merged);
}

/**
 * Decompress a base64-encoded gzip string back to the original JSON string.
 */
export async function gzipDecompress(base64: string): Promise<string> {
  const bytes = base64ToBytes(base64);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Serialize a GameState to JSON and gzip-compress it.
 * Returns the base64 payload plus byte-length metrics.
 */
export async function compressGameState(
  gameState: unknown,
): Promise<CompressedGameState> {
  const json = serializeGameState(gameState);
  const jsonBytes = new TextEncoder().encode(json).byteLength;
  const base64 = await gzipCompress(json);
  const gzipBytes = base64ToBytes(base64).byteLength;
  return { base64, jsonBytes, gzipBytes };
}

/**
 * Build the request body sent to POST /api/games.
 */
export async function buildSaveRequestBody(
  gameState: unknown,
  options: SaveRequestOptions = {},
): Promise<{
  gameId: string;
  slot: number;
  version: string;
  timestamp: number;
  data: string;
  format: string;
}> {
  const { base64 } = await compressGameState(gameState);
  const gameId = options.gameId ?? generateGameId();
  return {
    gameId,
    slot: options.slot ?? 1,
    version: SAVE_VERSION,
    timestamp: Date.now(),
    data: base64,
    format: SAVE_FORMAT,
  };
}

/**
 * Generate a reasonably unique game id when the caller does not supply one.
 */
export function generateGameId(): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `spacenautica-${rand}`;
}

/**
 * Persist a GameState to Cloudflare D1 by POSTing the gzip-compressed payload
 * to the /api/games worker endpoint.
 *
 * Returns the raw Response so callers can read status and body.
 */
export async function saveGameToServer(
  gameState: unknown,
  options: SaveRequestOptions = {},
): Promise<Response> {
  const body = await buildSaveRequestBody(gameState, options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? '/api/games';

  return fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Load deserialization (D1 -> decompress -> GameState) ────────────────

/** Result of loading a save: the version, timestamp, and deserialized GameState. */
export interface LoadedSave {
  /** Save format version emitted by serializeGameState. */
  version: string;
  /** Timestamp the save was created (ms epoch). */
  timestamp: number;
  /** The deserialized GameState object. */
  gameState: unknown;
}

export interface LoadGameOptions {
  /** Optional endpoint override. Defaults to '/api/games'. */
  endpoint?: string;
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
}

/**
 * Decompress a base64-encoded gzip payload and parse it back to a LoadedSave.
 *
 * Inverse of compressGameState: strips the `{ version, timestamp, gameState }`
 * envelope written by serializeGameState so callers get the raw GameState.
 */
export async function decompressGameState(base64: string): Promise<LoadedSave> {
  const json = await gzipDecompress(base64);
  const parsed = JSON.parse(json) as {
    version?: string;
    timestamp?: number;
    gameState?: unknown;
  };
  return {
    version: parsed.version ?? SAVE_VERSION,
    timestamp: parsed.timestamp ?? 0,
    gameState: parsed.gameState,
  };
}

function trimEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

/**
 * Load a GameState from Cloudflare D1 by GETting /api/games/:id, decompressing
 * the gzip payload, and parsing it back to a LoadedSave.
 *
 * The worker returns the stored row; the save payload lives in the `data`
 * field (gzip+json) or, for legacy rows, `game_state`. Returns the
 * deserialized save. Throws on non-OK response or a missing payload.
 */
export async function loadGameFromServer(
  gameId: string,
  options: LoadGameOptions = {},
): Promise<LoadedSave> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = trimEndpoint(options.endpoint ?? '/api/games');

  const response = await fetchImpl(`${endpoint}/${encodeURIComponent(gameId)}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Load failed: HTTP ${response.status}`);
  }

  const row = (await response.json()) as Record<string, unknown>;
  const payload = (row.data ?? row.game_state) as string | undefined;
  if (!payload) {
    throw new Error('Load failed: save contains no data payload');
  }

  return decompressGameState(payload);
}

/**
 * List the most recent save metadata for a persistence slot by GETting
 * /api/games?slot=N. Returns lightweight rows (no compressed payload) so a
 * menu can populate the load screen cheaply.
 */
export async function listSavesFromServer(
  slot: number,
  options: LoadGameOptions = {},
): Promise<Array<{ gameId: string; timestamp: number }>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = trimEndpoint(options.endpoint ?? '/api/games');

  const response = await fetchImpl(`${endpoint}?slot=${slot}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`List failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { saves?: Array<Record<string, unknown>> };
  const saves = body.saves ?? [];
  return saves.map((s) => ({
    gameId: String(s.id),
    timestamp: Number(s.updated_at ?? s.created_at ?? 0),
  }));
}
