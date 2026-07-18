import React, { useState, useEffect } from 'react';
import { CinematicScene } from './CinematicScene';

interface EndingChoiceProps {
  onHome: () => void;
  onFollow: () => void;
  show: boolean;
}

export function EndingChoice({ onHome, onFollow, show }: EndingChoiceProps) {
  const [showChoice, setShowChoice] = useState(false);

  useEffect(() => {
    if (show) {
      // Small delay to let CinematicScene start
      const timer = setTimeout(() => setShowChoice(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!show && !showChoice) return null;

  return (
    <>
      {/* Cinematic transition */}
      {show && <CinematicScene type="home" onTransition={() => {}} />}

      {/* Choice screen */}
      {showChoice && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 30, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '2rem',
            boxSizing: 'border-box',
          }}
        >
          <h1 style={{ color: '#00ffff', fontSize: '3rem', marginBottom: '2rem', textAlign: 'center' }}>
            GATEWAY ACTIVATED
          </h1>
          <p style={{ color: '#ffffff', fontSize: '1.2rem', maxWidth: '600px', textAlign: 'center', marginBottom: '3rem' }}>
            The Gateway hums with alien technology. The energy surges through its rings.
            You stand at the threshold—two paths lie before you.
          </p>

          <div style={{ display: 'flex', gap: '4rem', marginBottom: '3rem' }}>
            <button
              style={{
                padding: '2rem 4rem',
                fontSize: '1.5rem',
                background: '#0044aa',
                color: '#ffffff',
                border: '3px solid #00ffff',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.3s',
              }}
              onClick={onHome}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#0066dd';
                e.currentTarget.style.boxShadow = '0 0 20px #00ffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#0044aa';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              🏠 Return Home
            </button>

            <button
              style={{
                padding: '2rem 4rem',
                fontSize: '1.5rem',
                background: '#4400aa',
                color: '#ffffff',
                border: '3px solid #ff00ff',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.3s',
              }}
              onClick={onFollow}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#6600dd';
                e.currentTarget.style.boxShadow = '0 0 20px #ff00ff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#4400aa';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              🛸 Follow Them
            </button>
          </div>

          <p style={{ color: '#88aacc', fontSize: '1rem', textAlign: 'center' }}>
            Choose your destiny...
          </p>
        </div>
      )}
    </>
  );
}