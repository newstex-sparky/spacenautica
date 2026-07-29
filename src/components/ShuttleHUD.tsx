import { ShuttleHUD, ShuttleControlMode } from './Survival3D';

const styles = {
  hudContainer: {
    position: 'absolute' as const,
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between' as const,
    padding: '20px',
    zIndex: 100,
    fontFamily: 'Courier New, monospace' as const,
    color: '#00ff00',
    textShadow: '0 0 10px #00ff00',
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
  },
  leftPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    textAlign: 'left' as const,
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    alignItems: 'flex-end' as const,
    textAlign: 'right' as const,
  },
  label: {
    fontSize: '12px' as const,
    opacity: 0.8,
  },
  value: {
    fontSize: '18px' as const,
    fontWeight: 'bold' as const,
  },
  fuelContainer: {
    width: '250px',
    height: '20px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '2px solid #00ff00',
    borderRadius: 10,
    overflow: 'hidden' as const,
  },
  fuelFill: (fuelPercent: number) => ({
    width: `${fuelPercent}%` as const,
    height: '100%',
    backgroundColor: `linear-gradient(90deg, #00ff00 0%, #ffaa00 ${100 - fuelPercent}%, #ff3333 ${100 - fuelPercent}%)`,
    transition: 'width 0.1s',
  }),
  heading: {
    fontSize: '16px' as const,
  },
  speed: {
    fontSize: '16px' as const,
  },
  altitude: {
    fontSize: '16px' as const,
  },
  destination: {
    fontSize: '14px' as const,
    opacity: 0.7,
  },
  controls: {
    position: 'absolute' as const,
    bottom: '20px',
    left: '20px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '15px',
    borderRadius: 10,
    color: '#888',
    fontSize: '12px' as const,
    zIndex: 100,
    display: 'none' as const,
    '&.visible': {
      display: 'block' as const,
    },
  },
  controlKey: {
    backgroundColor: '#333',
    padding: '2px 6px',
    borderRadius: 3,
    color: 'white',
    margin: '0 2px',
    display: 'inline-block' as const,
  },
};

interface ShuttleHUDProps {
  shuttleHUD: ShuttleHUD;
  controlMode: ShuttleControlMode;
  onToggleControls: () => void;
}

export function ShuttleHUD({ shuttleHUD, controlMode, onToggleControls }: ShuttleHUDProps) {
  // Convert heading to compass direction
  const compassDirection = () => {
    const heading = Math.abs(shuttleHUD.heading) % 360;
    const degrees = Math.round((heading / 360) * 16);
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[degrees] || 'N';
  };

  return (
    <div style={styles.hudContainer}>
      {/* Top Row */}
      <div style={styles.topRow}>
        <div style={styles.leftPanel}>
          <div style={styles.label}>SYSTEM STATUS</div>
          <div>
            <span style={styles.value} className="shuttle-speed">
              {shuttleHUD.speed.toFixed(1)} km/s
            </span>
          </div>
          <div>
            <span style={styles.label}>ALTITUDE</span>
            <div style={styles.altitude} className="shuttle-altitude">
              {shuttleHUD.altitude.toFixed(1)} m
            </div>
          </div>
          <div>
            <span style={styles.label}>DESTINATION</span>
            <div style={styles.destination} className="shuttle-destination">
              {shuttleHUD.destination}
            </div>
          </div>
        </div>

        <div style={styles.rightPanel}>
          <div>
            <span style={styles.label}>HEADING</span>
            <div style={styles.heading} className="shuttle-heading">
              {compassDirection()} {Math.abs(shuttleHUD.heading % 360).toFixed(1)}°
            </div>
          </div>
          <div>
            <span style={styles.label}>H₂ FUEL</span>
            <div style={styles.fuelContainer} className="shuttle-fuel-container">
              <div style={styles.fuelFill(shuttleHUD.fuelPercent)} className="shuttle-fuel-fill" />
            </div>
          </div>
          <div className="shuttle-fuel-percent">
            {shuttleHUD.fuelPercent.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Controls hint */}
      <div style={{ ...styles.controls, ...(shuttleHUD.isVisible && { visible: true }) }}>
        <div style={{ marginBottom: '8px', color: '#00ff00' }}>⌨️ FLIGHT CONTROLS</div>
        <div>
          <span style={styles.controlKey}>W</span> <span style={styles.controlKey}>A</span> <span style={styles.controlKey}>S</span> <span style={styles.controlKey}>D</span>
          {' '}←→ Move
        </div>
        <div style={{ marginTop: '4px' }}>
          <span style={styles.controlKey}>Space</span> Thrust
        </div>
        <div style={{ marginTop: '4px' }}>
          <span style={styles.controlKey}>Q</span> <span style={styles.controlKey}>E</span> Pitch
        </div>
        <div style={{ marginTop: '4px' }}>
          <span style={styles.controlKey}>H</span> Toggle HUD
        </div>
        <div style={{ marginTop: '4px', color: '#ffaa00' }}>
          <span style={styles.controlKey}>P</span> Toggle Autopilot (Dock)
        </div>
      </div>
    </div>
  );
}