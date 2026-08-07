import { useState, useEffect, useRef, useCallback } from 'react';
import { Survival3D } from './components/Survival3D';
import { TechTreeHolographic } from './components/TechTreeHolographic';
import TechTree3D from './components/TechTree3D';
import { NarratorScene } from './components/NarratorScene';
import { HullBreach3D } from './components/HullBreach3D';
import { SettingsPanel } from './components/SettingsPanel';
import { ShuttleHUD, ShuttleControlMode } from './components/Survival3D';
import { LoadGameScreen } from './components/LoadGameScreen';

import { ShuttlePod } from './components/ShuttlePod';

// Save serialization pipeline (GameState -> JSON -> gzip -> D1 via /api/games).
// Load deserialization (D1 -> decompress -> GameState -> store).
import {
  saveGameToServer,
  loadGameFromServer,
  listSavesFromServer,
  buildSaveRequestBody,
  SAVE_VERSION,
  generateGameId,
} from './systems/saveSystem';
import {
  openOfflineStore,
  putOfflineSave,
  getOfflineSave,
  listOfflineSaves,
  deleteOfflineSave,
  type OfflineStore,
  type OfflineSaveRecord,
} from './systems/offlineStore';
import { createRetryQueue, type RetryQueue, type QueuedSave } from './systems/retryQueue';

export type BuildableStructureType = 'dome' | 'solar' | 'o2generator' | 'smelter' | 'refinery' | 'storage';
export type AsteroidType = 'iron' | 'ice' | 'oxygen';

// Build a localStorage-compatible snapshot string (same shape Survival3D emits).
function serializeGameStateForLocal(state: unknown): string {
  const snapshot = state as SaveData;
  return JSON.stringify({
    version: SAVE_VERSION,
    timestamp: Date.now(),
    ...snapshot,
  });
}

// Save data structure for localStorage
export interface SaveData {
  version: string;
  timestamp: number;
  gameId?: string;
  player: {
    position: [number, number, number];
    yaw: number;
    pitch: number;
  };
  resources: {
    iron: number;
    ice: number;
    oxygen: number;
    rawOre: number;
    h2: number;
    ironMetal: number;
    titanium: number;
  };
  inventory: Array<{ name: string; type: 'resource' | 'crafted' | 'tool'; count: number; max: number }>;
  structures: Array<{
    type: BuildableStructureType;
    position: [number, number, number];
    rotation: number;
    integrity: number;
  }>;
  asteroids: Array<{
    type: AsteroidType;
    position: [number, number, number];
    respawnTimer: number;
    isMined: boolean;
  }>;
  uiState: {
    buildType: BuildableStructureType;
  };
  gameFlags: {
    hasBroadcastSignal: boolean;
    rescueTriggered: boolean;
    rescued: boolean;
  };
}

type Screen = 'intro' | 'narrator' | 'hullBreach' | 'newgame' | 'continue' | 'settings' | 'loadgame' | 'techtree' | 'shuttle' | null;

export function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [show3D, setShow3D] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLoadGame, setShowLoadGame] = useState(false);
  const [showTechTreeHolographic, setShowTechTreeHolographic] = useState(false);
  const [pulse, setPulse] = useState(0);
  const rafRef = useRef<number>(0);
  const saveExistsRef = useRef(false);
  // Latest serializable game state published by Survival3D via onGetState.
  const latestGameStateRef = useRef<unknown>(null);
  // Restored save data to hand to Survival3D once it mounts.
  const restoreRef = useRef<SaveData | null>(null);
  // Stable id for this save file (created lazily on first save).
  const gameIdRef = useRef<string | null>(null);
  // IndexedDB offline snapshot store (opened lazily on first use).
  const offlineStoreRef = useRef<OfflineStore | null>(null);
  // Retry queue for saves that failed while offline.
  const retryQueueRef = useRef<RetryQueue | null>(null);

  // Tech tree research progress (in the main game)
  const [researchProgress, setResearchProgress] = useState<Set<string>>(new Set(['mining-basic']));

  // Load save data on mount
  useEffect(() => {
    const saveDataStr = localStorage.getItem('spacenautica_save');
    if (saveDataStr) {
      try {
        const saveData = JSON.parse(saveDataStr) as SaveData;
        saveExistsRef.current = true;
        if (saveData.gameId) {
          gameIdRef.current = saveData.gameId;
        }
        console.log('Save data loaded:', saveData);
      } catch (e) {
        console.error('Failed to load save data:', e);
      }
    }
  }, []);

  // Autosave hook driven by Survival3D: fired every 60 game-seconds of
  // simulated play. Persists the latest serialized state to D1 (local fallback).
  const onAutosave = useCallback((): void => {
    saveGameToCloud();
  }, [saveGameToCloud]);

  // Callback that Survival3D uses to publish the current serializable state.
  const onGetState = useCallback((state: unknown) => {
    latestGameStateRef.current = state;
  }, []);

  // Callback that Survival3D uses to restore a loaded save.
  const onRestoreState = useCallback((saveData: SaveData) => {
    restoreRef.current = saveData;
  }, []);

  // Lazily open the IndexedDB offline store. Returns null when unavailable.
  const getOfflineStore = useCallback(async (): Promise<OfflineStore | null> => {
    if (offlineStoreRef.current) return offlineStoreRef.current;
    try {
      const store = await openOfflineStore();
      offlineStoreRef.current = store;
      return store;
    } catch (e) {
      console.warn('IndexedDB offline store unavailable:', e);
      return null;
    }
  }, []);

  // Persist the latest snapshot to IndexedDB as a durable offline fallback.
  const writeOfflineSnapshot = useCallback(
    async (state: unknown, gameId: string): Promise<boolean> => {
      const store = await getOfflineStore();
      if (!store) return false;
      try {
        const payload = serializeGameStateForLocal(state);
        const record: OfflineSaveRecord = {
          gameId,
          slot: 1,
          payload,
          version: SAVE_VERSION,
          timestamp: Date.now(),
        };
        await putOfflineSave(store, record);
        return true;
      } catch (e) {
        console.warn('IndexedDB offline snapshot write failed:', e);
        return false;
      }
    },
    [getOfflineStore],
  );

  // Lazily create the in-memory retry queue.
  const getRetryQueue = useCallback((): RetryQueue => {
    if (!retryQueueRef.current) {
      retryQueueRef.current = createRetryQueue();
    }
    return retryQueueRef.current;
  }, []);

  // Replay any queued saves that failed while offline. Returns the number
  // successfully replayed.
  const flushRetryQueue = useCallback(async (): Promise<number> => {
    const queue = getRetryQueue();
    if (queue.size() === 0) return 0;
    const replayed = await queue.flush(async (save: QueuedSave) => {
      try {
        const response = await saveGameToServer(
          { __queuedPayload: save.data },
          { gameId: save.gameId, slot: save.slot },
        );
        return response.ok;
      } catch {
        return false;
      }
    });
    if (replayed > 0) {
      console.log(`Replayed ${replayed} queued save(s) from the offline retry queue`);
    }
    return replayed;
  }, [getRetryQueue]);

  // Save to D1 via /api/games (gzip-compressed). Falls back to IndexedDB,
  // then localStorage. Failed cloud saves are enqueued for later replay.
  const saveGameToCloud = useCallback(async (): Promise<boolean> => {
    const state = latestGameStateRef.current;
    if (!state) {
      console.warn('Cannot save: no game state available yet');
      return false;
    }
    if (!gameIdRef.current) {
      gameIdRef.current = generateGameId();
    }
    const gameId = gameIdRef.current;

    // Always keep a durable offline snapshot (IndexedDB first, then localStorage).
    const idbOk = await writeOfflineSnapshot(state, gameId);
    try {
      const snapshot = serializeGameStateForLocal(state);
      localStorage.setItem('spacenautica_save', snapshot);
      saveExistsRef.current = true;
    } catch (e) {
      console.error('Local save fallback failed:', e);
    }

    try {
      const response = await saveGameToServer(state, {
        gameId,
        slot: 1,
      });
      if (response.ok) {
        console.log('Save persisted to D1 via /api/games');
        return true;
      }
      console.warn(`Server save failed (HTTP ${response.status}), kept local copy`);
      // Enqueue the failed save for later replay.
      enqueueFailedSave(state, gameId);
      return false;
    } catch (e) {
      console.warn('Server save unavailable - local copy retained:', e);
      enqueueFailedSave(state, gameId);
      return false;
    }
  }, [writeOfflineSnapshot, getRetryQueue]);

  // Enqueue a failed cloud save so it can be replayed when connectivity returns.
  const enqueueFailedSave = useCallback(
    (state: unknown, gameId: string): void => {
      const queue = getRetryQueue();
      // Reuse the same serialization the server expects (gzip+json base64).
      void buildSaveRequestBody(state, { gameId, slot: 1 }).then((body) => {
        queue.enqueue({
          gameId,
          slot: 1,
          data: body.data,
          version: body.version,
        });
      });
    },
    [getRetryQueue],
  );

  // Read the latest offline snapshot from IndexedDB, if present.
  const readOfflineSnapshot = useCallback(
    async (gameId: string): Promise<SaveData | null> => {
      const store = await getOfflineStore();
      if (!store) return null;
      try {
        const record = await getOfflineSave(store, gameId);
        if (!record) return null;
        const parsed = JSON.parse(record.payload) as SaveData;
        return parsed;
      } catch (e) {
        console.warn('IndexedDB offline snapshot read failed:', e);
        return null;
      }
    },
    [getOfflineStore],
  );

  // Load from D1 (decompress -> GameState) and store the restored state so
  // Survival3D can consume it once it mounts. Falls back to IndexedDB, then
  // localStorage when the cloud fetch fails or no cloud save exists.
  const loadGameFromCloud = useCallback(async (): Promise<SaveData | null> => {
    // Prefer the cloud save when we have a known game id.
    if (gameIdRef.current) {
      try {
        const loaded = await loadGameFromServer(gameIdRef.current, { slot: 1 });
        const restored = loaded.gameState as SaveData;
        // Re-wrap in the local snapshot shape and keep it as the offline fallback.
        const snapshot = serializeGameStateForLocal(restored);
        localStorage.setItem('spacenautica_save', snapshot);
        saveExistsRef.current = true;
        restoreRef.current = restored;
        console.log('Game state restored from D1 via /api/games');
        return restored;
      } catch (e) {
        console.warn('Cloud load unavailable - falling back to offline copy:', e);
      }
    }

    // Fall back to the IndexedDB offline snapshot.
    if (gameIdRef.current) {
      const offline = await readOfflineSnapshot(gameIdRef.current);
      if (offline) {
        restoreRef.current = offline;
        console.log('Game state restored from IndexedDB offline snapshot');
        return offline;
      }
    }

    // Fall back to the local snapshot.
    const saveDataStr = localStorage.getItem('spacenautica_save');
    if (!saveDataStr) return null;
    try {
      const saveData = JSON.parse(saveDataStr) as SaveData;
      restoreRef.current = saveData;
      return saveData;
    } catch (e) {
      console.error('Failed to parse local save:', e);
      return null;
    }
  }, [readOfflineSnapshot]);

  // Establish an early save shortly after the game mounts (creates the gameId
  // and seeds the offline snapshot). The recurring cadence — every 60
  // game-seconds — is driven by Survival3D via the onAutosave hook, so it
  // respects pause and simulated time rather than wall-clock.
  useEffect(() => {
    if (!show3D) return;
    const first = window.setTimeout(() => {
      saveGameToCloud();
    }, 2000);
    return () => {
      window.clearTimeout(first);
    };
  }, [show3D, saveGameToCloud]);

  // When connectivity returns, replay any saves that failed while offline.
  useEffect(() => {
    const onOnline = () => {
      void flushRetryQueue();
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
    };
  }, [flushRetryQueue]);

  // Helper: Load game state from localStorage
  const loadGame = useCallback((): SaveData | null => {
    const saveDataStr = localStorage.getItem('spacenautica_save');
    if (!saveDataStr) return null;

    try {
      let saveData = JSON.parse(saveDataStr) as SaveData;

      // Version check
      if (saveData.version !== SAVE_VERSION) {
        console.warn('Save file version mismatch, attempting migration');
        // TODO: Implement version migration
      }

      // Restore state in Survival3D component
      if (onRestoreState && saveData) {
        onRestoreState(saveData);
      }

      return saveData;
    } catch (e) {
      console.error('Failed to load game:', e);
      return null;
    }
  }, [onRestoreState]);

  // Handle 'New Game' - clear save data and start a fresh expedition
  const handleNewGame = useCallback(() => {
    const oldGameId = gameIdRef.current;
    localStorage.removeItem('spacenautica_save');
    saveExistsRef.current = false;
    restoreRef.current = null;
    latestGameStateRef.current = null;
    gameIdRef.current = null;
    // Clear the offline IndexedDB snapshot and any queued retries.
    if (offlineStoreRef.current && oldGameId) {
      void deleteOfflineSave(offlineStoreRef.current, oldGameId).catch(() => {});
    }
    if (retryQueueRef.current) {
      retryQueueRef.current.clear();
    }
    setShowLoadGame(false);
    setScreen(null);
    setShow3D(true);
  }, []);

  // Handle 'Continue' - load save and start game
  const handleContinue = useCallback(async () => {
    const saveData = (await loadGameFromCloud()) ?? loadGame();
    if (saveData) {
      setScreen(null);
      setShow3D(true);
      console.log('Starting game from save:', saveData);
      // Pass save data to Survival3D component to restore state
      if (onRestoreState) {
        onRestoreState(saveData);
      }
    } else {
      console.error('No save data found');
    }
  }, [loadGame, loadGameFromCloud, onRestoreState]);

  const handleQuestComplete = () => {
    setScreen(null);
    setShow3D(true);
  };

  // Handle 'Continue' with new function name to avoid collision
  const handleContinueGame = useCallback(async () => {
    const saveData = (await loadGameFromCloud()) ?? loadGame();
    if (saveData) {
      setScreen(null);
      setShow3D(true);
      console.log('Starting game from save:', saveData);
      if (onRestoreState) {
        onRestoreState(saveData);
      }
    } else {
      console.error('No save data found');
    }
  }, [loadGame, loadGameFromCloud, onRestoreState]);

  // Handle Settings
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  // Load Game screen state: the local save slot plus any cloud saves.
  const [localSaveInfo, setLocalSaveInfo] = useState<{ exists: boolean; timestamp: number } | null>(null);
  const [cloudSaves, setCloudSaves] = useState<Array<{ gameId: string; timestamp: number }>>([]);
  const [loadingLoads, setLoadingLoads] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Open the Load Game screen and refresh the save listings.
  const handleOpenLoadGame = useCallback(async () => {
    setShowLoadGame(true);
    setLoadError(null);
    setLoadingLoads(true);
    setCloudSaves([]);

    // Local save slot.
    try {
      const raw = localStorage.getItem('spacenautica_save');
      if (raw) {
        const parsed = JSON.parse(raw) as SaveData;
        setLocalSaveInfo({ exists: true, timestamp: parsed.timestamp ?? Date.now() });
      } else {
        setLocalSaveInfo({ exists: false, timestamp: 0 });
      }
    } catch {
      setLocalSaveInfo({ exists: false, timestamp: 0 });
    }

    // Cloud saves from D1 (metadata only — no payload).
    try {
      const saves = await listSavesFromServer(1);
      setCloudSaves(saves);
    } catch (e) {
      console.warn('Cloud save listing unavailable:', e);
      setLoadError('Cloud saves unavailable — showing local save only.');
    } finally {
      setLoadingLoads(false);
    }
  }, []);

  const handleCloseLoadGame = useCallback(() => {
    setShowLoadGame(false);
  }, []);

  // Resume the latest game: prefer the most recent cloud save, else the local snapshot.
  const resumeGame = useCallback(
    async (preferredGameId?: string) => {
      const restore = async (saveData: SaveData | null) => {
        if (!saveData) return;
        restoreRef.current = saveData;
        setShowLoadGame(false);
        setScreen(null);
        setShow3D(true);
        if (saveData.gameId) gameIdRef.current = saveData.gameId;
        onRestoreState(saveData);
      };

      // If a specific cloud id was chosen, load it directly.
      if (preferredGameId) {
        try {
          const loaded = await loadGameFromServer(preferredGameId, { slot: 1 });
          const restored = loaded.gameState as SaveData;
          const snapshot = serializeGameStateForLocal(restored);
          localStorage.setItem('spacenautica_save', snapshot);
          saveExistsRef.current = true;
          return restore({ ...restored, gameId: preferredGameId });
        } catch (e) {
          console.warn('Cloud load failed:', e);
          setLoadError('Failed to load that cloud save.');
          return;
        }
      }

      // Otherwise prefer a cloud save for our known game id, then the local slot.
      if (gameIdRef.current) {
        try {
          const loaded = await loadGameFromServer(gameIdRef.current, { slot: 1 });
          const restored = loaded.gameState as SaveData;
          const snapshot = serializeGameStateForLocal(restored);
          localStorage.setItem('spacenautica_save', snapshot);
          saveExistsRef.current = true;
          return restore(restored);
        } catch {
          // fall through to local
        }
      }

      const local = loadGame();
      if (local) return restore(local);
      console.warn('No save data found');
    },
    [loadGame, loadGameFromServer, onRestoreState],
  );

  // Handle shuttle landing
  const handleShuttleLand = useCallback(() => {
    console.log('Shuttle landed successfully');
    setShow3D(false);
    setScreen('intro');
  }, []);

  return (
    <div className="app">
      {/* Intro screen */}
      {screen === 'intro' && !show3D && (
        <div className="intro-screen">
          {/* Animated star background */}
          <div className="star-field" />

          {/* Title with pulse animation */}
          <h1 className="intro-title" style={{ transform: `scale(${pulse})` }}>
            SPACENAUTICA
          </h1>
          <p className="intro-subtitle">SURVIVE THE VOID</p>

          {/* Story text */}
          <div className="intro-story">
            <p>The colony ship <em>Meridian</em> was 37 jumps from home when a gravity anomaly tore it apart.</p>
            <p>You wake in a jettisoned escape pod. O2 is running out. Asteroids drift nearby — iron, ice, oxygen crystals.</p>
            <p><strong>Mine. Build. Survive the void.</strong></p>
          </div>

          {/* Info cards */}
          <div className="intro-cards">
            <div className="intro-card">
              <h3 className="card-title">⚙️ SETTINGS</h3>
              <div className="card-line">ESC — Pause Menu</div>
            </div>

            <div className="intro-card">
              <h3 className="card-title">🎮 CONTROLS</h3>
              <div className="card-line">WASD — Move</div>
              <div className="card-line">Mouse — Aim</div>
              <div className="card-line">Click — Mine / Build</div>
              <div className="card-line">B — Build mode</div>
              <div className="card-line">1/2/3 — Select structure</div>
              <div className="card-line">ESC — Pause</div>
            </div>

            <div className="intro-card">
              <h3 className="card-title">⛏️ OBJECTIVES</h3>
              <div className="card-line">Mine asteroids for Iron</div>
              <div className="card-line">Collect Ice for O2 generators</div>
              <div className="card-line">Harvest Oxygen Crystals</div>
              <div className="card-line">Build your base</div>
              <div className="card-line">Don't run out of O2</div>
            </div>
          </div>

          {/* Buttons */}
          <button className="intro-start" onClick={handleNewGame}>
            New Game
          </button>
          <button className="intro-continue" onClick={() => setShowLoadGame(true)}>
            Load Game
          </button>
          <button className="intro-hull-breach" onClick={() => setShowSettings(true)}>
            ⚙️ Settings
          </button>
          <div className="intro-button-row">
            <button className="intro-start-alt" onClick={() => setScreen('narrator')}>
              Access Signal Questline
            </button>
            <button className="intro-hull-breach" onClick={() => setScreen('hullBreach')}>
              View Hull Breaches
            </button>
            <button className="intro-start" onClick={() => setScreen('techtree')}>
              🔬 Tech Tree
            </button>
            <button className="intro-start-alt" onClick={() => setShowTechTreeHolographic(true)}>
              💡 Holographic Tech Tree
            </button>
            <button className="intro-start" onClick={() => setScreen('shuttle')}>
              🚀 Launch Shuttle
            </button>
          </div>

          {/* Footer */}
          <div className="intro-footer">
            <p>Built with Three.js + React + Vite — 3D First-Person</p>
            <p style={{ opacity: 0.5, fontSize: '10px' }}>Survive the void. Stay alive.</p>
          </div>
        </div>
      )}

      {/* Narrator Questline Screen */}
      {screen === 'narrator' && <NarratorScene onQuestComplete={handleQuestComplete} onGameOver={() => {}} />}

      {/* Hull Breach 3D Screen */}
      {screen === 'hullBreach' && <HullBreach3D onExit={() => setScreen('intro')} />}

      {/* Holographic Tech Tree Screen */}
      {showTechTreeHolographic && (
        <TechTreeHolographic
          isOpen={showTechTreeHolographic}
          onClose={() => setShowTechTreeHolographic(false)}
          onResearch={(nodeId) => {
            setResearchProgress(prev => new Set([...prev, nodeId]));
          }}
          researchProgress={researchProgress}
        />
      )}

      {/* Tech Tree 3D Screen */}
      {screen === 'techtree' && <TechTree3D />}

      {/* Shuttle Pod Screen */}
      {screen === 'shuttle' && <ShuttlePod onDock={handleShuttleLand} />}

      {/* Main 3D Survival Mode */}
      {show3D && (
        <div className="survival-3d-container">
          <Survival3D
            onGetState={onGetState}
            onRestoreState={onRestoreState}
            onAutosave={onAutosave}
            restoreData={restoreRef.current}
          />
          <button className="back-to-main" onClick={() => { setShow3D(false); setScreen('intro'); }}>
            ← Back to Main Menu
          </button>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && <SettingsPanel onClose={handleCloseSettings} />}

      {/* Load Game Screen */}
      {showLoadGame && (
        <LoadGameScreen
          localSave={localSaveInfo}
          cloudSaves={cloudSaves}
          loading={loadingLoads}
          error={loadError}
          onLoadLocal={() => resumeGame()}
          onLoadCloud={(gameId) => resumeGame(gameId)}
          onBack={handleCloseLoadGame}
        />
      )}
    </div>
  );
}