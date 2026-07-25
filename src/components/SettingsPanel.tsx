import React, { useState, useEffect } from 'react';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [graphicsQuality, setGraphicsQuality] = useState<string>('medium');
  const [fov, setFov] = useState<number>(75);
  const [masterVolume, setMasterVolume] = useState<number>(80);
  const [sfxVolume, setSfxVolume] = useState<number>(80);
  const [musicVolume, setMusicVolume] = useState<number>(60);
  const [mouseSensitivity, setMouseSensitivity] = useState<number>(1.0);
  const [gamepadSensitivity, setGamepadSensitivity] = useState<number>(1.0);
  const [controlScheme, setControlScheme] = useState<'keyboard' | 'gamepad'>('keyboard');

  useEffect(() => {
    const savedSettings = localStorage.getItem('spacenautica_settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        if (settings.graphicsQuality) setGraphicsQuality(settings.graphicsQuality);
        if (settings.fov) setFov(settings.fov);
        if (settings.masterVolume) setMasterVolume(settings.masterVolume);
        if (settings.sfxVolume) setSfxVolume(settings.sfxVolume);
        if (settings.musicVolume) setMusicVolume(settings.musicVolume);
        if (settings.mouseSensitivity) setMouseSensitivity(settings.mouseSensitivity);
        if (settings.gamepadSensitivity) setGamepadSensitivity(settings.gamepadSensitivity);
        if (settings.controlScheme) setControlScheme(settings.controlScheme);
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }
  }, []);

  const saveSettings = () => {
    const settings = {
      graphicsQuality,
      fov,
      masterVolume,
      sfxVolume,
      musicVolume,
      mouseSensitivity,
      gamepadSensitivity,
      controlScheme,
    };
    localStorage.setItem('spacenautica_settings', JSON.stringify(settings));
    onClose();
  };

  const resetSettings = () => {
    setGraphicsQuality('medium');
    setFov(75);
    setMasterVolume(80);
    setSfxVolume(80);
    setMusicVolume(60);
    setMouseSensitivity(1.0);
    setGamepadSensitivity(1.0);
    setControlScheme('keyboard');
    localStorage.removeItem('spacenautica_settings');
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        padding: '40px',
        borderRadius: '20px',
        border: '2px solid #00ffff',
        boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)',
        minWidth: '600px',
        maxWidth: '800px',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <h2 style={{ color: '#00ffff', margin: 0, fontSize: '2rem' }}>Settings</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ff4444',
              fontSize: '2rem',
              cursor: 'pointer',
              padding: '5px 15px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px' }}>
          <div style={{ flex: '1', minWidth: '250px' }}>
            <h3 style={{ color: '#fff', borderBottom: '2px solid #00ffff', paddingBottom: '10px', marginBottom: '15px' }}>
              Graphics
            </h3>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Graphics Quality
              </label>
              <select
                value={graphicsQuality}
                onChange={(e) => setGraphicsQuality(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#0a0a1a',
                  border: '1px solid #00ffff',
                  color: '#00ffff',
                  borderRadius: '5px',
                  fontSize: '1rem',
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Field of View: {fov}°
              </label>
              <input
                type="range"
                min="60"
                max="110"
                step="5"
                value={fov}
                onChange={(e) => setFov(parseInt(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#00ffff',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '0.8rem', marginTop: '5px' }}>
                <span>60°</span>
                <span>110°</span>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Shadows: {graphicsQuality !== 'low' ? 'On' : 'Off'}
              </label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button
                  onClick={() => setGraphicsQuality('low')}
                  style={{
                    padding: '8px 16px',
                    background: graphicsQuality === 'low' ? '#00ffff' : '#0a0a1a',
                    border: graphicsQuality === 'low' ? '2px solid #00ffff' : '1px solid #444',
                    color: graphicsQuality === 'low' ? '#000' : '#ccc',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    flex: '1',
                  }}
                >
                  Low
                </button>
                <button
                  onClick={() => setGraphicsQuality('medium')}
                  style={{
                    padding: '8px 16px',
                    background: graphicsQuality === 'medium' ? '#00ffff' : '#0a0a1a',
                    border: graphicsQuality === 'medium' ? '2px solid #00ffff' : '1px solid #444',
                    color: graphicsQuality === 'medium' ? '#000' : '#ccc',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    flex: '1',
                  }}
                >
                  Medium
                </button>
                <button
                  onClick={() => setGraphicsQuality('high')}
                  style={{
                    padding: '8px 16px',
                    background: graphicsQuality === 'high' ? '#00ffff' : '#0a0a1a',
                    border: graphicsQuality === 'high' ? '2px solid #00ffff' : '1px solid #444',
                    color: graphicsQuality === 'high' ? '#000' : '#ccc',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    flex: '1',
                  }}
                >
                  High
                </button>
              </div>
            </div>
          </div>

          <div style={{ flex: '1', minWidth: '250px' }}>
            <h3 style={{ color: '#fff', borderBottom: '2px solid #ff6600', paddingBottom: '10px', marginBottom: '15px' }}>
              Audio
            </h3>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Master Volume: {masterVolume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={masterVolume}
                onChange={(e) => setMasterVolume(parseInt(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#ff6600',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                SFX Volume: {sfxVolume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={sfxVolume}
                onChange={(e) => setSfxVolume(parseInt(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#ff6600',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Music Volume: {musicVolume}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={musicVolume}
                onChange={(e) => setMusicVolume(parseInt(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#ff6600',
                }}
              />
            </div>
          </div>

          <div style={{ flex: '1', minWidth: '250px' }}>
            <h3 style={{ color: '#fff', borderBottom: '2px solid #00ff88', paddingBottom: '10px', marginBottom: '15px' }}>
              Controls
            </h3>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Mouse Sensitivity: {mouseSensitivity.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={mouseSensitivity}
                onChange={(e) => setMouseSensitivity(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#00ff88',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '0.8rem', marginTop: '5px' }}>
                <span>0.1x</span>
                <span>3.0x</span>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Gamepad Sensitivity: {gamepadSensitivity.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={gamepadSensitivity}
                onChange={(e) => setGamepadSensitivity(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  accentColor: '#00ff88',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '0.8rem', marginTop: '5px' }}>
                <span>0.1x</span>
                <span>3.0x</span>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#ccc', display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>
                Control Scheme
              </label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button
                  onClick={() => setControlScheme('keyboard')}
                  style={{
                    padding: '8px 16px',
                    background: controlScheme === 'keyboard' ? '#00ff88' : '#0a0a1a',
                    border: controlScheme === 'keyboard' ? '2px solid #00ff88' : '1px solid #444',
                    color: controlScheme === 'keyboard' ? '#000' : '#ccc',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    flex: '1',
                  }}
                >
                  Keyboard
                </button>
                <button
                  onClick={() => setControlScheme('gamepad')}
                  style={{
                    padding: '8px 16px',
                    background: controlScheme === 'gamepad' ? '#00ff88' : '#0a0a1a',
                    border: controlScheme === 'gamepad' ? '2px solid #00ff88' : '1px solid #444',
                    color: controlScheme === 'gamepad' ? '#000' : '#ccc',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    flex: '1',
                  }}
                >
                  Gamepad
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '30px', display: 'flex', gap: '15px' }}>
          <button
            onClick={saveSettings}
            style={{
              flex: '1',
              padding: '15px',
              background: 'linear-gradient(135deg, #00ffff 0%, #0088ff 100%)',
              border: 'none',
              color: '#000',
              borderRadius: '5px',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
          <button
            onClick={resetSettings}
            style={{
              flex: '1',
              padding: '15px',
              background: 'transparent',
              border: '2px solid #ff4444',
              color: '#ff4444',
              borderRadius: '5px',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;