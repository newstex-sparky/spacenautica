import { useState } from 'react';

/**
 * Lightweight cloud save descriptor returned by listSavesFromServer.
 * The compressed payload is not fetched here — only metadata — so the
 * load screen stays cheap to populate.
 */
export interface CloudSaveEntry {
  gameId: string;
  timestamp: number;
}

/** Describes the local (localStorage) save slot, if one exists. */
export interface LocalSaveEntry {
  exists: boolean;
  timestamp: number;
}

interface LoadGameScreenProps {
  localSave: LocalSaveEntry | null;
  cloudSaves: CloudSaveEntry[];
  loading: boolean;
  error: string | null;
  onLoadLocal: () => void;
  onLoadCloud: (gameId: string) => void;
  onBack: () => void;
}

/**
 * Load Game menu: lists the local save slot plus any cloud saves retrieved
 * from /api/games?slot=N. Clicking an entry hands the selection to App via
 * the onLoad* callbacks, which perform the actual deserialization + mount.
 */
export function LoadGameScreen({
  localSave,
  cloudSaves,
  loading,
  error,
  onLoadLocal,
  onLoadCloud,
  onBack,
}: LoadGameScreenProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const formatTime = (ts: number): string =>
    ts > 0 ? new Date(ts).toLocaleString() : 'unknown time';

  const hasAny = !!localSave?.exists || cloudSaves.length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          padding: '40px',
          borderRadius: '20px',
          border: '2px solid #00ffff',
          boxShadow: '0 0 30px rgba(0, 255, 255, 0.3)',
          minWidth: '560px',
          maxWidth: '720px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <h2 style={{ color: '#00ffff', margin: 0, fontSize: '2rem' }}>Load Game</h2>
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: '2px solid #44ddff',
              color: '#44ddff',
              padding: '8px 16px',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            ← Back
          </button>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(255, 68, 68, 0.15)',
              border: '1px solid #ff4444',
              color: '#ff8888',
              padding: '10px 14px',
              borderRadius: '6px',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div style={{ color: '#88bbcc', padding: '20px 0', textAlign: 'center' }}>
            Checking for cloud saves…
          </div>
        )}

        {!hasAny && !loading && (
          <div
            style={{
              color: '#8899aa',
              padding: '30px 0',
              textAlign: 'center',
              border: '1px dashed #445566',
              borderRadius: '8px',
              margin: '10px 0 20px',
            }}
          >
            No saved games found.
            <br />
            Start a New Game to begin your expedition.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {localSave?.exists && (
            <button
              onClick={onLoadLocal}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                padding: '16px 20px',
                background: 'rgba(0, 255, 255, 0.08)',
                border: '2px solid #00ffff',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#fff',
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 'bold', color: '#00ffff' }}>Local Save</span>
              <span style={{ color: '#99aabb', fontSize: '0.85rem' }}>
                {formatTime(localSave.timestamp)}
              </span>
              <span style={{ color: '#44ddff' }}>Load →</span>
            </button>
          )}

          {cloudSaves.map((s) => (
            <button
              key={s.gameId}
              onClick={() => onLoadCloud(s.gameId)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                padding: '16px 20px',
                background: 'rgba(0, 136, 255, 0.08)',
                border: '2px solid #0088ff',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#fff',
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 'bold', color: '#66aaff' }}>Cloud Save</span>
              <span style={{ color: '#99aabb', fontSize: '0.85rem' }}>
                {formatTime(s.timestamp)}
              </span>
              <span style={{ color: '#66aaff' }}>Load →</span>
            </button>
          ))}
        </div>

        {hasAny && (
          <div style={{ marginTop: '28px', display: 'flex', justifyContent: 'flex-end' }}>
            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                style={{
                  background: 'transparent',
                  border: '1px solid #ff4444',
                  color: '#ff5555',
                  padding: '8px 16px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                }}
              >
                Clear local save
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ color: '#ff8888', fontSize: '0.9rem' }}>Erase local save?</span>
                <button
                  onClick={() => {
                    localStorage.removeItem('spacenautica_save');
                    window.location.reload();
                  }}
                  style={{
                    background: '#ff4444',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                  }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #666',
                    color: '#ccc',
                    padding: '8px 16px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LoadGameScreen;
