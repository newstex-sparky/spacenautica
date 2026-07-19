import { useState } from 'react';
import { Survival3D } from './components/Survival3D';
import { NarratorScene } from './components/NarratorScene';
import { HullBreach3D } from './components/HullBreach3D';

type Screen = 'intro' | 'narrator' | 'hullBreach' | null;

export function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [show3D, setShow3D] = useState(false);

  const handleQuestComplete = () => {
    setScreen(null);
    setShow3D(true);
  };

  return (
    <div className="app">
      {/* Intro screen */}
      {screen === 'intro' && !show3D && (
        <div className="intro-screen">
          <h1 className="intro-title">SPACENAUTICA</h1>
          <p className="intro-subtitle">Survive the Void</p>
          <div className="intro-story">
            <p>The colony ship <em>Meridian</em> was 37 jumps from home when a gravity anomaly tore it apart.</p>
            <p>You wake in a jettisoned escape pod. 30 minutes of O2. No contact. Just you and the void.</p>
            <p><strong>Survive. Build. Explore. Find the signal.</strong></p>
          </div>
          <button className="intro-start" onClick={() => setShow3D(true)}>
            Launch EVA
          </button>
          <button className="intro-start-alt" onClick={() => setScreen('narrator')}>
            Access Signal Questline
          </button>
          <button className="intro-hull-breach" onClick={() => setScreen('hullBreach')}>
            View Hull Breaches
          </button>
          <div className="intro-controls">
            <p><strong>Controls:</strong></p>
            <p>🎮 Gamepad: Left stick=move, RT=mine, A=action, B=cancel, Y=inv, X=build, Start=tech</p>
            <p>⌨️ Keyboard: WASD=move, F=mine, Space=action, Esc=cancel, I=inv, B=build, C=craft, T=tech, M=map</p>
            <p>📱 Touch: Virtual joystick + action buttons</p>
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
          <Survival3D />
          <button className="back-to-main" onClick={() => { setShow3D(false); setScreen('intro'); }}>
            ← Back to Main Menu
          </button>
        </div>
      )}
    </div>
  );
}