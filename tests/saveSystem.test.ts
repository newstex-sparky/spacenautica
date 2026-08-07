import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, match } from 'node:assert';

import {
  SAVE_VERSION,
  serializeGameState,
  gzipCompress,
  gzipDecompress,
  compressGameState,
  buildSaveRequestBody,
  saveGameToServer,
  decompressGameState,
  loadGameFromServer,
  listSavesFromServer,
  AUTOSAVE_GAME_SECONDS,
  createAutosaveTimer,
} from '../src/systems/saveSystem.ts';

// A representative GameState shape (mirrors Survival3D buildSaveData).
const SAMPLE_GAME_STATE = {
  version: '0.3.0',
  player: { position: [1, 2, 3], rotation: [0, 0, 0], yaw: 0.5, pitch: -0.2 },
  resources: { iron: 12, ice: 5, oxygen: 80, rawOre: 7, h2: 42, ironMetal: 3, titanium: 1 },
  inventory: [
    { name: 'Iron', type: 'resource', count: 12, max: 99 },
    { name: 'Repair Tool', type: 'tool', count: 1, max: 1 },
  ],
  equippedTool: 'Repair Tool',
  structures: [
    { type: 'dome', position: [0, 0, 0], rotation: [0, 0, 0], integrity: 100 },
    { type: 'refinery', position: [5, 0, 5], rotation: [0, 1, 0], integrity: 88 },
  ],
  asteroids: [
    { type: 'iron', position: [10, 0, 10], rotation: [0, 0, 0], scale: 1, respawnTimer: 0, isMined: false },
  ],
  uiState: { buildMode: false, buildType: 'dome', lowO2Warning: false, deathSequence: false },
};

test('SAVE_VERSION is exported', () => {
  strictEqual(SAVE_VERSION, '0.3.0');
});

test('GameState serializes to valid, parseable JSON', () => {
  const json = serializeGameState(SAMPLE_GAME_STATE);
  ok(typeof json === 'string');
  const parsed = JSON.parse(json);
  strictEqual(parsed.version, '0.3.0');
  ok(typeof parsed.timestamp === 'number');
  deepStrictEqual(parsed.gameState.resources.iron, 12);
  deepStrictEqual(parsed.gameState.structures.length, 2);
});

test('serialized JSON contains the full nested GameState', () => {
  const json = serializeGameState(SAMPLE_GAME_STATE);
  match(json, /"equippedTool":"Repair Tool"/);
  match(json, /"respawnTimer":0/);
  ok(json.length > 100, 'serialized payload should be substantial');
});

test('gzip compress produces a smaller base64 payload than raw JSON', async () => {
  const json = serializeGameState(SAMPLE_GAME_STATE);
  const { base64, jsonBytes, gzipBytes } = await compressGameState(SAMPLE_GAME_STATE);
  ok(typeof base64 === 'string');
  ok(base64.length > 0);
  ok(jsonBytes > 0);
  ok(gzipBytes > 0);
  // base64 adds ~33% overhead, so this proves compression shrank the bytes.
  ok(gzipBytes < jsonBytes, `expected gzip (${gzipBytes}) < json (${jsonBytes})`);
});

test('gzip roundtrip: compress then decompress returns original JSON', async () => {
  const json = serializeGameState(SAMPLE_GAME_STATE);
  const b64 = await gzipCompress(json);
  const roundtrip = await gzipDecompress(b64);
  strictEqual(roundtrip, json);
});

test('gzip roundtrip: full GameState survives compress -> decompress -> parse', async () => {
  const json = serializeGameState(SAMPLE_GAME_STATE);
  const b64 = await gzipCompress(json);
  const restoredJson = await gzipDecompress(b64);
  const restored = JSON.parse(restoredJson);
  deepStrictEqual(restored.gameState, SAMPLE_GAME_STATE);
});

test('buildSaveRequestBody wraps gzip data in the /api/games contract', async () => {
  const body = await buildSaveRequestBody(SAMPLE_GAME_STATE, {
    gameId: 'game-abc-123',
    slot: 1,
  });
  ok(body.gameId, 'game-abc-123');
  ok(body.slot === 1);
  ok(body.version === '0.3.0');
  ok(typeof body.timestamp === 'number');
  ok(typeof body.data === 'string' && body.data.length > 0, 'data is a non-empty base64 string');
  ok(body.format === 'gzip+json');
  // data field must be valid base64 of gzip (verify decompression roundtrip)
  const restoredJson = await gzipDecompress(body.data);
  deepStrictEqual(JSON.parse(restoredJson).gameState, SAMPLE_GAME_STATE);
});

test('saveGameToServer POSTs gzip data to /api/games and returns the response', async () => {
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody: any = null;
  const fakeFetch = async (url: string, init: any): Promise<Response> => {
    capturedUrl = url;
    capturedMethod = init.method;
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'game-abc-123' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };

  const response = await saveGameToServer(SAMPLE_GAME_STATE, {
    gameId: 'game-abc-123',
    slot: 1,
    fetchImpl: fakeFetch,
  });

  strictEqual(capturedUrl, '/api/games');
  strictEqual(capturedMethod, 'POST');
  ok(capturedBody.gameId === 'game-abc-123');
  ok(capturedBody.slot === 1);
  ok(typeof capturedBody.data === 'string');
  strictEqual(response.status, 201);

  const created = await response.json();
  strictEqual(created.id, 'game-abc-123');
});

test('saveGameToServer supports a custom endpoint override', async () => {
  let capturedUrl = '';
  const fakeFetch = async (url: string, init: any): Promise<Response> => {
    capturedUrl = url;
    return new Response('{}', { status: 201 });
  };
  await saveGameToServer(SAMPLE_GAME_STATE, {
    gameId: 'g1',
    fetchImpl: fakeFetch,
    endpoint: '/custom/api/games',
  });
  strictEqual(capturedUrl, '/custom/api/games');
});

// ─── M3-4: Load deserialization (D1 -> decompress -> GameState) ──────────

test('decompressGameState reverses compressGameState back to the raw GameState', async () => {
  const { base64 } = await compressGameState(SAMPLE_GAME_STATE);
  const loaded = await decompressGameState(base64);

  strictEqual(loaded.version, SAVE_VERSION);
  ok(typeof loaded.timestamp === 'number' && loaded.timestamp > 0);
  deepStrictEqual(loaded.gameState, SAMPLE_GAME_STATE);
});

test('decompressGameState roundtrips the full nested structure', async () => {
  const { base64 } = await compressGameState(SAMPLE_GAME_STATE);
  const loaded = await decompressGameState(base64);
  const gs = loaded.gameState as typeof SAMPLE_GAME_STATE;

  deepStrictEqual(gs.resources, SAMPLE_GAME_STATE.resources);
  deepStrictEqual(gs.structures, SAMPLE_GAME_STATE.structures);
  deepStrictEqual(gs.inventory, SAMPLE_GAME_STATE.inventory);
  deepStrictEqual(gs.asteroids, SAMPLE_GAME_STATE.asteroids);
});

test('loadGameFromServer GETs /api/games/:id, decompresses, and returns GameState', async () => {
  const { base64 } = await compressGameState(SAMPLE_GAME_STATE);
  let capturedUrl = '';
  const fakeFetch = async (url: string): Promise<Response> => {
    capturedUrl = url;
    return new Response(JSON.stringify({ id: 'g1', data: base64 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const loaded = await loadGameFromServer('g1', { fetchImpl: fakeFetch });

  strictEqual(capturedUrl, '/api/games/g1');
  strictEqual(loaded.version, SAVE_VERSION);
  deepStrictEqual(loaded.gameState, SAMPLE_GAME_STATE);
});

test('loadGameFromServer reads legacy game_state field when data is absent', async () => {
  const { base64 } = await compressGameState(SAMPLE_GAME_STATE);
  const fakeFetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ id: 'legacy', game_state: base64 }), { status: 200 });

  const loaded = await loadGameFromServer('legacy', { fetchImpl: fakeFetch });
  deepStrictEqual(loaded.gameState, SAMPLE_GAME_STATE);
});

test('loadGameFromServer throws on non-OK response', async () => {
  const fakeFetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: 'Save not found' }), { status: 404 });

  await assertLoadRejects(fakeFetch);
});

test('loadGameFromServer throws when the save has no payload', async () => {
  const fakeFetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ id: 'g1' }), { status: 200 });

  await assertLoadRejects(fakeFetch);
});

test('loadGameFromServer trims a trailing slash from the endpoint', async () => {
  const { base64 } = await compressGameState(SAMPLE_GAME_STATE);
  let capturedUrl = '';
  const fakeFetch = async (url: string): Promise<Response> => {
    capturedUrl = url;
    return new Response(JSON.stringify({ id: 'g1', data: base64 }), { status: 200 });
  };

  await loadGameFromServer('g1', { endpoint: '/api/games/', fetchImpl: fakeFetch });
  strictEqual(capturedUrl, '/api/games/g1');
});

test('listSavesFromServer GETs /api/games?slot=N and maps lightweight rows', async () => {
  let capturedUrl = '';
  const fakeFetch = async (url: string): Promise<Response> => {
    capturedUrl = url;
    return new Response(
      JSON.stringify({
        saves: [
          { id: 'g1', updated_at: 111 },
          { id: 'g2', updated_at: 222 },
        ],
      }),
      { status: 200 },
    );
  };

  const saves = await listSavesFromServer(1, { fetchImpl: fakeFetch });

  strictEqual(capturedUrl, '/api/games?slot=1');
  deepStrictEqual(saves, [
    { gameId: 'g1', timestamp: 111 },
    { gameId: 'g2', timestamp: 222 },
  ]);
});

test('listSavesFromServer tolerates an empty result', async () => {
  const fakeFetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ saves: [] }), { status: 200 });

  const saves = await listSavesFromServer(1, { fetchImpl: fakeFetch });
  deepStrictEqual(saves, []);
});

async function assertLoadRejects(fakeFetch: (url: string, init?: any) => Promise<Response>): Promise<void> {
  let rejected = false;
  try {
    await loadGameFromServer('g1', { fetchImpl: fakeFetch });
  } catch {
    rejected = true;
  }
  ok(rejected, 'expected loadGameFromServer to reject');
}

// ─── M3-5: Autosave hook (every 60 game-seconds) ──────────────────────────

test('AUTOSAVE_GAME_SECONDS is 60', () => {
  strictEqual(AUTOSAVE_GAME_SECONDS, 60);
});

test('createAutosaveTimer fires exactly once when 60 game-seconds accumulate', () => {
  const timer = createAutosaveTimer();
  let fires = 0;

  // 30s of play: no autosave yet.
  strictEqual(timer.tick(30), false);
  strictEqual(fires, 0);
  strictEqual(timer.elapsed, 30);

  // Another 30s crosses the 60s threshold exactly.
  strictEqual(timer.tick(30), true);
  fires += 1;
  strictEqual(fires, 1);
  // The timer reset after firing.
  strictEqual(timer.elapsed, 0);
});

test('createAutosaveTimer accumulates and fires repeatedly across cycles', () => {
  const timer = createAutosaveTimer();
  let fires = 0;

  // 10 cycles of 60 game-seconds = 600 total game-seconds, 10 fires.
  for (let i = 0; i < 10; i++) {
    for (let frame = 0; frame < 60; frame++) {
      if (timer.tick(1)) fires += 1;
    }
  }
  strictEqual(fires, 10);
  strictEqual(timer.elapsed, 0);
});

test('createAutosaveTimer ignores invalid, zero, and negative deltas', () => {
  const timer = createAutosaveTimer();
  strictEqual(timer.tick(0), false);
  strictEqual(timer.tick(-5), false);
  strictEqual(timer.tick(Number.NaN), false);
  strictEqual(timer.elapsed, 0);
});

test('createAutosaveTimer accepts a custom interval', () => {
  const timer = createAutosaveTimer(10);
  strictEqual(timer.tick(10), true);
  strictEqual(timer.tick(10), true);
});

test('createAutosaveTimer.reset clears accumulated time', () => {
  const timer = createAutosaveTimer();
  timer.tick(59);
  strictEqual(timer.elapsed, 59);
  timer.reset();
  strictEqual(timer.elapsed, 0);
  // After a reset we must accumulate a full 60s before firing again.
  strictEqual(timer.tick(59), false);
  strictEqual(timer.tick(1), true);
});

test('createAutosaveTimer does not fire when total play time is below threshold', () => {
  const timer = createAutosaveTimer();
  // 59.999 game-seconds: just under one interval.
  strictEqual(timer.tick(59.999), false);
  strictEqual(timer.elapsed, 59.999);
});
