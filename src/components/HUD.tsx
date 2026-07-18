import type { GameEngine } from '../engine/GameEngine';

interface Props {
  engine: GameEngine;
}

export function HUD({ engine }: Props) {
  const stats = engine.player.stats;
  const o2Pct = (stats.oxygen / stats.maxOxygen) * 100;
  const powerPct = (stats.power / stats.maxPower) * 100;
  const healthPct = (stats.health / stats.maxHealth) * 100;

  const o2Color = o2Pct < 20 ? '#ff4444' : o2Pct < 50 ? '#ffaa00' : '#44ddff';
  const o2Min = Math.floor(stats.oxygen / 60);
  const o2Sec = Math.floor(stats.oxygen % 60);

  return (
    <div className="hud">
      {/* Top bar: survival stats */}
      <div className="hud-top">
        <div className="hud-stat">
          <span className="hud-label">O₂</span>
          <div className="hud-bar">
            <div className="hud-bar-fill" style={{ width: `${o2Pct}%`, background: o2Color }} />
          </div>
          <span className="hud-value" style={{ color: o2Color }}>{o2Min}:{o2Sec.toString().padStart(2, '0')}</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">PWR</span>
          <div className="hud-bar">
            <div className="hud-bar-fill" style={{ width: `${powerPct}%`, background: '#44ff44' }} />
          </div>
          <span className="hud-value">{Math.round(powerPct)}%</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">HP</span>
          <div className="hud-bar">
            <div className="hud-bar-fill" style={{ width: `${healthPct}%`, background: '#ff6666' }} />
          </div>
          <span className="hud-value">{Math.round(stats.health)}</span>
        </div>
      </div>

      {/* Top right: time + status */}
      <div className="hud-time">
        <div className="hud-time-text">{engine.gameTime.timeString}</div>
        <div className="hud-status">
          {engine.player.inStation ? '🟢 STATION' : '🟡 EVA'}
          {engine.buildMode ? ' | 🔨 BUILDING' : ''}
        </div>
      </div>

      {/* Hotbar */}
      <div className="hud-hotbar">
        {engine.hotbar.map((itemId, i) => (
          <div
            key={i}
            className={`hotbar-slot ${i === engine.hotbarIndex ? 'active' : ''}`}
            onClick={() => { engine.hotbarIndex = i; engine.callbacks.onStateChange(); }}
          >
            <span className="hotbar-icon">{getItemEmoji(itemId)}</span>
            <span className="hotbar-key">{i + 1}</span>
            <span className="hotbar-count">
              {engine.player.countItem(itemId) || ''}
            </span>
          </div>
        ))}
      </div>

      {/* Build mode indicator */}
      {engine.buildMode && (
        <div className="hud-build-mode">
          <span>Placing: {engine.buildMode}</span>
          <button onClick={() => engine.setBuildMode(null)}>Cancel (B)</button>
        </div>
      )}
    </div>
  );
}

function getItemEmoji(itemId: string): string {
  const emojis: Record<string, string> = {
    mining_laser: '⛏️',
    repair_tool: '🔧',
    scanner: '📡',
    ration: '🍱',
    air_tank: '🫧',
    jetpack_mk1: '🎒',
    jetpack_mk2: '🚀',
  };
  return emojis[itemId] ?? '❓';
}