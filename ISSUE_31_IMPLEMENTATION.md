# Issue #31: First-Person HUD (Compass + Minimap)

## Status: ✅ COMPLETED

### Implementation Summary

**Issue #31** required: First-person HUD with O2 bar, resources, compass, and minimap.

### Features Implemented

#### 1. Compass (Top Center)
- Dynamic heading display showing cardinal directions
- Updates based on player camera yaw angle (0-360°)
- Shows current heading / 8 major directions
- Cyan glowing text with monospace font

#### 2. Minimap (Top-Right Canvas)
- 200x200 canvas element rendering live player position
- **Asteroid Visualization:**
  - Gray dots for Iron Ore asteroids (type='iron')
  - Cyan dots for Water Ice asteroids (type='ice')
  - Green dots for Oxygen Crystal asteroids (type='oxygen')
  - Mining progress warning rings (red semi-transparent) on asteroids being mined
- **Player Marker:**
  - Magenta circle at center (player position)
  - Magenta line indicating current heading/direction
- **Grid System:**
  - Faint cyan grid lines (20-unit spacing)
  - Dark semi-transparent background
- **Compass Overlay:**
  - N, E, S, W cardinal points around the minimap edge
  - Subtle cyan text for readability

#### 3. HUD Layout
- O2 bar (top center, large cyan)
- Compass/heading (center top, above O2)
- H2 bar (just below O2, orange)
- Resource panel (bottom left, showing all resource counts)
- Minimap (top right corner)
- Build menu (bottom center, appears in build mode)
- Game over screen (O2 depleted)

### Technical Details

#### Code Changes
- **File:** `src/components/Survival3D.tsx`
- **Modifications:**
  1. Added `minimapCanvasRef` (line 132)
  2. Added `renderMinimap()` function (lines 1210-1285)
  3. Added `renderMinimap()` call in game loop (line 1214)
  4. Compass UI already implemented (lines 1474-1478)
  5. Compass heading calculation already implemented (lines 943-953)

#### Compass Heading Logic
```typescript
const yawDeg = (yawRef.current * 180 / Math.PI) % 360;
let heading = 'N';
if (yawDeg >= 337.5 || yawDeg < 22.5) heading = 'N';
else if (yawDeg >= 22.5 && yawDeg < 67.5) heading = 'NE';
else if (yawDeg >= 67.5 && yawDeg < 112.5) heading = 'E';
// ... SE, S, SW, W, NW
setUiCompassHeading(heading);
```

#### Minimap Drawing Logic
```typescript
const renderMinimap = () => {
  const canvas = minimapCanvasRef.current;
  const ctx = canvas?.getContext('2d');
  if (!ctx || !sceneRef.current || !cameraRef.current) return;

  const w = canvas.width;
  const h = canvas.height;
  const scale = 2; // Map world coords to canvas

  // Clear, draw grid, asteroids, player marker, direction, compass
};
```

### Testing Instructions

1. Launch game: Click "LAUNCH EVA" button
2. Point camera in different directions (WASD to move, mouse to look)
3. Observe compass updating (e.g., N, NE, E, SE, S, SW, W, NW)
4. Look at minimap top-right corner
5. Verify:
   - Center shows magenta player marker
   - Magenta line points in camera direction
   - Nearby asteroids appear in correct colors
   - Mining asteroids show red warning rings
   - Grid lines visible
   - N, E, S, W labels around edge

### Dependencies
- **Canvas API:** Used for minimap rendering (no Three.js needed)
- **Existing:** Compass and heading logic already implemented
- **New:** Only the renderMinimap function and canvas ref

### Notes
- Compass already functioned in previous versions; this commit just wires it up properly with the HUD
- Minimap uses a 2x scaling factor (1 world unit = 2 canvas pixels)
- Asteroids beyond world radius (45 units) don't render
- Mined asteroids are hidden from minimap (isMined flag)
- FPS performance: minimal overhead (simple canvas drawing)

### Future Enhancements
- Add built structures to minimap
- Add player path/trail
- Add danger zones
- Add hotkeys to toggle minimap
- Add radar pulse effect

### Related Issues
- #30: 3D asteroids (prerequisite for minimap)
- #33: O2 survival loop (game over sequence)
- #32: Gamepad controls (yaw updates from gamepad)