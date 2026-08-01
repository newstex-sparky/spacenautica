import { useState, useEffect, useRef, useCallback } from 'react';
import { Survival3D } from './components/Survival3D';
import { TechTreeHolographic } from './components/TechTreeHolographic';
import TechTree3D from './components/TechTree3D';
import { NarratorScene } from './components/NarratorScene';
import { HullBreach3D } from './components/HullBreach3D';
import { SettingsPanel } from './components/SettingsPanel';
import { ShuttleHUD, ShuttleControlMode } from './components/Survival3D';

import { ShuttlePod } from './components/ShuttlePod';

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

type Screen = 'intro' | 'narrator' | 'hullBreach' | 'newgame' | 'continue' | 'settings' | 'techtree' | 'shuttle' | null;

export function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [show3D, setShow3D] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTechTreeHolographic, setShowTechTreeHolographic] = useState(false);
  const [pulse, setPulse] = useState(0);
  const rafRef = useRef<number>(0);
  const saveExistsRef = useRef(false);

  // Tech tree research progress (in the main game)
  const [researchProgress, setResearchProgress] = useState<Set<string>>(new Set(['mining-basic']));

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

  // Auto-save every 30 seconds - handled internally by Survival3D component
  const saveGame = useCallback((): void => {
    console.log('Game save triggered - handled by Survival3D component');
  }, []);

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

  // Handle 'Continue' with new function name to avoid collision
  const handleContinueGame = useCallback(() => {
    const saveData = loadGame();
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
  }, [loadGame, onRestoreState]);

  // Handle Settings
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
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
          {saveExistsRef.current && (
            <button className="intro-continue" onClick={() => handleContinueGame()}>
              Continue
            </button>
          )}
          <button className="intro-hull-breach" onClick={() => setScreen('settings')}>
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
          />
          <button className="back-to-main" onClick={() => { setShow3D(false); setScreen('intro'); }}>
            ← Back to Main Menu
          </button>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && <SettingsPanel onClose={handleCloseSettings} />}
    </div>
  );
}