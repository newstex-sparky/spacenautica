import { useRef, useEffect, useCallback } from 'react';
import type { GameEngine } from '../engine/GameEngine';
import type { InputState } from '../engine/types';

interface Props {
  engine: GameEngine;
  onStateChange: () => void;
}

export function TouchControls({ engine, onStateChange }: Props) {
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const moveTouchId = useRef<number | null>(null);

  // Set up gamepad polling
  useEffect(() => {
    let rafId: number;

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;
        // Dead zone
        const dz = 0.15;
        const moveX = Math.abs(gp.axes[0]) > dz ? gp.axes[0] : 0;
        const moveY = Math.abs(gp.axes[1]) > dz ? gp.axes[1] : 0;
        const aimX = Math.abs(gp.axes[2]) > dz ? gp.axes[2] : 0;
        const aimY = Math.abs(gp.axes[3]) > dz ? gp.axes[3] : 0;

        engine.input.moveX = moveX;
        engine.input.moveY = moveY;
        engine.input.aimX = aimX;
        engine.input.aimY = aimY;

        // Buttons: 0=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 6=LT, 7=RT, 8=Back, 9=Start
        const wasAction = engine.input.action;
        const wasCancel = engine.input.cancel;
        const wasInv = engine.input.inventory;
        const wasBuild = engine.input.build;
        const wasCraft = engine.input.craft;
        const wasTech = engine.input.techtree;
        const wasMap = engine.input.map;
        const wasHL = engine.input.hotbarLeft;
        const wasHR = engine.input.hotbarRight;

        engine.input.action = gp.buttons[0]?.pressed || false;
        engine.input.cancel = gp.buttons[1]?.pressed || false;
        engine.input.fire = gp.buttons[7]?.pressed || false; // RT
        engine.input.boost = gp.buttons[6]?.pressed || false; // LT
        engine.input.inventory = gp.buttons[3]?.pressed || false; // Y
        engine.input.build = gp.buttons[2]?.pressed || false; // X
        engine.input.craft = gp.buttons[8]?.pressed || false; // Back/Select
        engine.input.techtree = gp.buttons[9]?.pressed || false; // Start
        engine.input.map = gp.buttons[4]?.pressed || false; // LB
        engine.input.hotbarLeft = gp.buttons[4]?.pressed || false;
        engine.input.hotbarRight = gp.buttons[5]?.pressed || false; // RB

        // Keyboard fallback
        handleKeyboard(engine);

        rafId = requestAnimationFrame(pollGamepad);
      }
      if (!gamepads.some(gp => gp)) {
        handleKeyboard(engine);
        rafId = requestAnimationFrame(pollGamepad);
      }
    };

    pollGamepad();
    return () => cancelAnimationFrame(rafId);
  }, [engine]);

  // Keyboard handling
  const keysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.code);
      // Action keys
      if (e.code === 'Space' || e.code === 'Enter') engine.input.action = true;
      if (e.code === 'Escape') engine.input.cancel = true;
      if (e.code === 'KeyI') engine.input.inventory = true;
      if (e.code === 'KeyB') engine.input.build = true;
      if (e.code === 'KeyC') engine.input.craft = true;
      if (e.code === 'KeyT') engine.input.techtree = true;
      if (e.code === 'KeyM') engine.input.map = true;
      if (e.code === 'KeyF' || e.code === 'KeyJ') engine.input.fire = true;
      if (e.code === 'ShiftLeft') engine.input.boost = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      if (e.code === 'Space' || e.code === 'Enter') engine.input.action = false;
      if (e.code === 'KeyF' || e.code === 'KeyJ') engine.input.fire = false;
      if (e.code === 'ShiftLeft') engine.input.boost = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [engine]);

  function handleKeyboard(engine: GameEngine) {
    const keys = keysRef.current;
    let mx = 0, my = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;

    // Only override if no gamepad active
    const gamepads = navigator.getGamepads();
    const hasGamepad = gamepads.some(gp => gp && Math.abs(gp.axes[0]) > 0.15);
    if (!hasGamepad) {
      engine.input.moveX = mx;
      engine.input.moveY = my;
      // Aim follows movement for keyboard
      if (mx !== 0 || my !== 0) {
        engine.input.aimX = mx;
        engine.input.aimY = my;
      }
    }
  }

  // Joystick touch handling
  const handleJoystickStart = useCallback((e: React.TouchEvent) => {
    if (moveTouchId.current !== null) return;
    const touch = e.changedTouches[0];
    moveTouchId.current = touch.identifier;
    updateJoystick(touch.clientX, touch.clientY);
  }, []);

  const handleJoystickMove = useCallback((e: React.TouchEvent) => {
    if (moveTouchId.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === moveTouchId.current) {
        updateJoystick(touch.clientX, touch.clientY);
      }
    }
  }, []);

  const handleJoystickEnd = useCallback((e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === moveTouchId.current) {
        moveTouchId.current = null;
        if (knobRef.current) {
          knobRef.current.style.transform = 'translate(-50%, -50%)';
        }
        engine.input.moveX = 0;
        engine.input.moveY = 0;
      }
    }
  }, [engine]);

  function updateJoystick(touchX: number, touchY: number) {
    if (!joystickRef.current || !knobRef.current) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = touchX - cx;
    const dy = touchY - cy;
    const maxDist = rect.width / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    knobRef.current.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

    const nx = clampedDist / maxDist * Math.cos(angle);
    const ny = clampedDist / maxDist * Math.sin(angle);
    if (Math.abs(nx) > 0.15 || Math.abs(ny) > 0.15) {
      engine.input.moveX = nx;
      engine.input.moveY = ny;
    } else {
      engine.input.moveX = 0;
      engine.input.moveY = 0;
    }
  }

  const handleAction = useCallback(() => {
    engine.input.action = true;
    onStateChange();
  }, [engine, onStateChange]);

  const handleFire = useCallback((down: boolean) => {
    engine.input.fire = down;
  }, [engine]);

  return (
    <div className="touch-controls">
      {/* Left: virtual joystick */}
      <div
        ref={joystickRef}
        className="joystick"
        onTouchStart={handleJoystickStart}
        onTouchMove={handleJoystickMove}
        onTouchEnd={handleJoystickEnd}
        onTouchCancel={handleJoystickEnd}
      >
        <div ref={knobRef} className="joystick-knob" />
      </div>

      {/* Right: action buttons */}
      <div className="action-buttons">
        <button
          className="action-btn fire-btn"
          onTouchStart={(e) => { e.preventDefault(); handleFire(true); }}
          onTouchEnd={(e) => { e.preventDefault(); handleFire(false); }}
          onMouseDown={() => handleFire(true)}
          onMouseUp={() => handleFire(false)}
        >
          🔥
        </button>
        <button
          className="action-btn action-btn-primary"
          onTouchStart={(e) => { e.preventDefault(); handleAction(); }}
          onClick={handleAction}
        >
          ✋
        </button>
        <button className="action-btn" onClick={() => { engine.input.inventory = true; onStateChange(); }}>
          🎒
        </button>
        <button className="action-btn" onClick={() => { engine.input.build = true; onStateChange(); }}>
          🔨
        </button>
        <button className="action-btn" onClick={() => { engine.input.craft = true; onStateChange(); }}>
          🏭
        </button>
        <button className="action-btn" onClick={() => { engine.input.techtree = true; onStateChange(); }}>
          🧪
        </button>
      </div>

      {/* Bottom nav */}
      <div className="bottom-nav">
        <button onClick={() => { engine.toggleScreen('inventory'); onStateChange(); }}>🎒 Inv</button>
        <button onClick={() => { engine.toggleScreen('build'); onStateChange(); }}>🔨 Build</button>
        <button onClick={() => { engine.toggleScreen('craft'); onStateChange(); }}>🏭 Craft</button>
        <button onClick={() => { engine.toggleScreen('techtree'); onStateChange(); }}>🧪 Tech</button>
        <button onClick={() => { engine.toggleScreen('map'); onStateChange(); }}>🗺️ Map</button>
      </div>
    </div>
  );
}