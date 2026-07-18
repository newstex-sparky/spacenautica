import { useState, useRef, useEffect, useCallback } from 'react';
import { GameEngine } from './engine/GameEngine';
import type { GameScreen, Notification } from './engine/types';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/HUD';
import { TouchControls } from './components/TouchControls';
import {
  InventoryModal, BuildModal, CraftModal, TechTreeModal, MapModal,
} from './components/Modals';
import { EndingChoice } from './components/EndingChoice';

export function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const [, forceUpdate] = useState(0);
  const [screen, setScreen] = useState<GameScreen | null>('intro');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const [endingChoice, setEndingChoice] = useState<'home' | 'aliens' | null>(null);

  const update = useCallback(() => forceUpdate(n => n + 1), []);

  if (!engineRef.current && !gameOver) {
    engineRef.current = new GameEngine({
      onStateChange: update,
      onNotification: (n: Notification) => {
        setNotifications(prev => [...prev, n]);
        setTimeout(() => {
          setNotifications(prev => prev.filter(p => p.id !== n.id));
        }, n.timeout);
      },
      onScreenChange: (s: GameScreen | null) => setScreen(s),
      onGameOver: (reason: string) => {
        setGameOver(reason);
        setScreen('gameover');
      },
    });
  }

  const engine = engineRef.current;
  if (!engine) return null;

  const startGame = () => {
    engine.start();
    setScreen(null);
    update();
  };

  const restart = () => {
    engine.restart();
    setGameOver(null);
    setScreen(null);
    setEndingChoice(null);
    update();
  };

  const handleEndingChoice = (choice: 'home' | 'aliens') => {
    setEndingChoice(choice);
    // Show the appropriate cinematic
    if (choice === 'home') {
      setTimeout(() => {
        // Home ending - show home cinematic and credits
        alert(`CREDITS\n\nSpacenautica v0.1\n\nDeveloped by Newstex\n\nA survival game in the void.\n\nThank you for playing!`);
      }, 1000);
    } else {
      setTimeout(() => {
        // Aliens ending - show sequel hook
        alert(`THE ALIENS\n\nYou step through the Gateway.\n\nThe alien vessel awaits.\n\n— To be continued in Spacenautica II —`);
      }, 1000);
    }
  };

  return (
    <div className="app">
      {/* Intro screen */}
      {screen === 'intro' && (
        <div className="intro-screen">
          <h1 className="intro-title">SPACENAUTICA</h1>
          <p className="intro-subtitle">Survive the Void</p>
          <div className="intro-story">
            <p>The colony ship <em>Meridian</em> was 37 jumps from home when a gravity anomaly tore it apart.</p>
            <p>You wake in a jettisoned escape pod. 30 minutes of O2. No contact. Just you and the void.</p>
            <p><strong>Survive. Build. Explore. Find the signal.</strong></p>
          </div>
          <button className="intro-start" onClick={startGame}>
            Launch EVA
          </button>
          <div className="intro-controls">
            <p><strong>Controls:</strong></p>
            <p>🎮 Gamepad: Left stick=move, RT=mine, A=action, B=cancel, Y=inv, X=build, Start=tech</p>
            <p>⌨️ Keyboard: WASD=move, F=mine, Space=action, Esc=cancel, I=inv, B=build, C=craft, T=tech, M=map</p>
            <p>📱 Touch: Virtual joystick + action buttons</p>
          </div>
        </div>
      )}

      {/* Game over screen */}
      {screen === 'gameover' && (
        <div className="gameover-screen">
          <h1>SIGNAL LOST</h1>
          <p className="gameover-reason">{gameOver}</p>
          <button className="gameover-restart" onClick={restart}>
            Deploy New Pod
          </button>
        </div>
      )}

      {/* Game canvas */}
      {screen !== 'intro' && screen !== 'gameover' && (
        <>
          <GameCanvas engine={engine} />
          <HUD engine={engine} />
          <TouchControls engine={engine} onStateChange={update} />
        </>
      )}

      {/* Modals */}
      {screen === 'inventory' && <InventoryModal engine={engine} />}
      {screen === 'build' && <BuildModal engine={engine} />}
      {screen === 'craft' && <CraftModal engine={engine} />}
      {screen === 'techtree' && <TechTreeModal engine={engine} />}
      {screen === 'map' && <MapModal engine={engine} />}

      {/* Ending Choice */}
      {endingChoice && (
        <EndingChoice
          show={true}
          onHome={() => handleEndingChoice('home')}
          onFollow={() => handleEndingChoice('aliens')}
        />
      )}

      {/* Notifications */}
      <div className="notifications">
        {notifications.map(n => (
          <div key={n.id} className={`notification ${n.type}`}>
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}