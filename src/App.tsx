import { useState, useEffect, useRef } from 'react';
import { Survival3D } from './components/Survival3D';
import { NarratorScene } from './components/NarratorScene';
import { HullBreach3D } from './components/HullBreach3D';

type Screen = 'intro' | 'narrator' | 'hullBreach' | null;

export function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [show3D, setShow3D] = useState(false);
  const [pulse, setPulse] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let frame = 0;
    const animate = () => {
      frame = (frame + 1) % 120;
      setPulse(Math.sin(frame / 15) * 0.15 + 1);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

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
          <button className="intro-start" onClick={() => setShow3D(true)}>
            LAUNCH EVA
          </button>
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
          <Survival3D />
          <button className="back-to-main" onClick={() => { setShow3D(false); setScreen('intro'); }}>
            ← Back to Main Menu
          </button>
        </div>
      )}
    </div>
  );
}