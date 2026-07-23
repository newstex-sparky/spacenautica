import { useState, useEffect, useRef } from 'react';
import { Survival3D } from './components/Survival3D';
import { NarratorScene } from './components/NarratorScene';
import { HullBreach3D } from './components/HullBreach3D';

export type BuildableStructureType = 'dome' | 'solar' | 'o2generator' | 'smelter' | 'refinery' | 'storage';
export type AsteroidType = 'iron' | 'ice' | 'oxygen';

// Save data structure for localStorage
export interface SaveData {
  version: string;
  timestamp: number;
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

type Screen = 'intro' | 'narrator' | 'hullBreach' | 'newgame' | 'continue' | null;

export function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [show3D, setShow3D] = useState(false);
  const [pulse, setPulse] = useState(0);
  const rafRef = useRef<number>(0);
  const saveExistsRef = useRef(false);

  // Load save data on mount
  useEffect(() => {
    const saveDataStr = localStorage.getItem('spacenautica_save');
    if (saveDataStr) {
      try {
        const saveData = JSON.parse(saveDataStr) as SaveData;
        saveExistsRef.current = true;
        console.log('Save data loaded:', saveData);
      } catch (e) {
        console.error('Failed to load save data:', e);
      }
    }
  }, []);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (saveExistsRef.current) {
      const interval = setInterval(() => {
        saveGame();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [saveExistsRef.current]);

  // Save on page unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      saveGame();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveGame]);

  // Helper: Save game state to localStorage
  const saveGame = useCallback((): void => {
    if (!saveExistsRef.current) return;

    try {
      // Get state from Survival3D component
      const state = onGetState ? onGetState() : null;
      if (!state) {
        console.warn('Cannot save: onGetState callback not provided');
        return;
      }

      const saveData: SaveData = {
        version: '0.3.0',
        timestamp: Date.now(),
        player: {
          position: state.player?.position || [0, 1.6, 0],
          yaw: state.player?.yaw ?? 0,
          pitch: state.player?.pitch ?? 0,
          rotation: state.player?.rotation || [0, 0, 0],
        },
        resources: state.resources || {
          iron: 0, ice: 0, oxygen: 0, rawOre: 0, h2: 0, ironMetal: 0, titanium: 0,
        },
        inventory: state.inventory || [],
        equippedTool: state.equippedTool || 'repair-tool',
        structures: state.structures || [],
        asteroids: state.asteroids || [],
        uiState: state.uiState || {
          buildMode: false,
          buildType: 'dome',
          lowO2Warning: false,
          deathSequence: false,
        },
        gameFlags: state.gameFlags || {
          hasBroadcastSignal: false,
          rescueTriggered: false,
          rescued: false,
        },
      };

      localStorage.setItem('spacenautica_save', JSON.stringify(saveData));
      console.log('Game saved:', saveData);
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [onGetState]);

  // Helper: Load game state from localStorage
  const loadGame = useCallback((): SaveData | null => {
    const saveDataStr = localStorage.getItem('spacenautica_save');
    if (!saveDataStr) return null;

    try {
      let saveData = JSON.parse(saveDataStr) as SaveData;

      // Version check
      if (saveData.version !== '0.3.0') {
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

  // Handle 'New Game' - clear save data
  const handleNewGame = useCallback(() => {
    localStorage.removeItem('spacenautica_save');
    saveExistsRef.current = false;
    setScreen('intro');
  }, []);

  // Handle 'Continue' - load save and start game
  const handleContinue = useCallback(() => {
    const saveData = loadGame();
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
  }, [loadGame, onRestoreState]);

  const handleQuestComplete = () => {
    setScreen(null);
    setShow3D(true);
  };

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

            <div className="intro-card">
              <h3 className="card-title">🪨 RESOURCES</h3>
              <div className="card-line">Iron (gray) — structures</div>
              <div className="card-line">Ice (cyan) — O2 generators</div>
              <div className="card-line">O2 Crystal (green) — refills O2</div>
              <div className="card-line">Habitat costs 10 Iron</div>
              <div className="card-line">O2 Generator costs 10 Ice</div>
            </div>
          </div>

          {/* Buttons */}
          <button className="intro-start" onClick={handleNewGame}>
            NEW GAME
          </button>
          {saveExistsRef.current && (
            <button className="intro-start-alt" onClick={handleContinue}>
              CONTINUE
            </button>
          )}
          <div className="intro-button-row">
            <button className="intro-start-alt" onClick={() => setScreen('narrator')}>
              Access Signal Questline
            </button>
            <button className="intro-hull-breach" onClick={() => setScreen('hullBreach')}>
              View Hull Breaches
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

      {/* Main 3D Survival Mode */}
      {show3D && (
        <div className="survival-3d-container">
          <Survival3D
            onGetState={onGetState}
            onRestoreState={onRestoreState}
          />
          <button className="back-to-main" onClick={() => { setShow3D(false); setScreen('intro'); }}>
            ← Back to Main Menu
          </button>
        </div>
      )}
    </div>
  );
}