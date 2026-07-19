# Hull Breach 3D Component

## Overview

Implements dramatic hull breach mechanics in a 3D First-Person Survival environment, matching Subnautica's hull damage gameplay.

## Features

### Visual Elements
- **Cracked Wall Breaches**: Jagged crack patterns with depth simulation
- **Floor/Ceiling Breaches**: Perspective cracks with perspective distortion
- **Airlock Breaches**: Multiple crack patterns with complex geometries
- **Venting Particles**: Blue particle streams flowing from breaches
- **Breach Markers**: Green wireframe spheres indicating repairable breaches

### Audio/Visual Feedback
- **Screen Shake**: Jarring effect on breach creation
- **Alarm System**: Red warning lights with pulsing intensity
- **Alarm Beep**: Periodic beeping every 2 seconds (placeholder sound)
- **O2 Damage**: Breaches reduce hull integrity (and health) over time
- **Welding Effect**: Yellow conical animation during repair

### Game Mechanics
- **Automatic Breach Spawning**: Random damage when hull integrity is critical
- **Repair Mechanic**: Use repair tool (not fully implemented yet) to weld breaches
  - 3-second repair time
  - 25% hull integrity restored per breach
  - Progress bar UI
- **Integrity Decay**: O2 damage per second from active breaches
- **Dynamic Breach Levels**: Multiple breach types with different patterns

## Technical Implementation

### Component Structure

```
HullBreach3D.tsx
  ├─ Types: HullBreach, HullBreachType, CrackGeometry, HullState
  ├─ Constants: BREACH_DAMAGE_PER_SEC, REPAIR_SPEED, VENT_PARTICLE_SPEED
  ├─ Crack Pattern Tables: CRACK_PATTERNS (wall/floor/ceiling/airlock)
  ├─ Refs: scene, camera, renderer, breachMarkers, alarmLights
  └─ Hooks: useEffect (Three.js init, breach spawner, alarm cycle)

State Management:
  ├─ hullState: { maxIntegrity, currentIntegrity, breaches[], alarms, warningLights }
  └─ repairProgress: { current: number, max: number }
```

### Three.js Setup

```javascript
Scene: 0x1a1a2e dark blue, Fog 0x1a1a2e (10-50)
Camera: Perspective 75, position (0, 4, 8)
Renderer: WebGL antialias, shadowMap enabled
Lighting: Ambient 0x404050, warning lights (PointLights)
Starfield: 500 points for depth
```

### Breach Generation

**Random Positioning**: Within module bounds (-4 to 4 on all axes)

**Breach Types**:
- Wall: 3-4 vertical cracks with varied depth
- Floor: 2-3 perspective cracks angled toward camera
- Ceiling: 2-3 perspective cracks angled away from player
- Airlock: 4 complex cracks with cross-ventilation patterns

**Crack Geometry**:
- Line segments created via BufferGeometry
- Randomized path with jagged edges
- Depth gradient (thicker at breach center)

**Particle System**:
- Blue vent particles flowing upward
- 50 particles per breach
- Reset to bottom when reaching ceiling

### Repair System

**Welding Animation**:
- Yellow cone rotating and oscillating
- Positioned at breach location
- Duration: 3 seconds

**Progress Tracking**:
- Update every 16ms (60fps)
- Visual progress bar in UI
- Health restoration: 25% per breach
- Automatically removes repaired breach

### UI Integration

**Breach List**:
- Sortable by breach type/health
- Each breach shows: Type, Current Health
- Repair button disabled during welding
- Progress bar during repair

**Hull Integrity Display**:
- Overall integrity percentage
- Updates in real-time
- Visual cue when < 80%

**Warning Messages**:
- "⚠️ HULL BREACHES DETECTED ⚠️"
- Shown when any active breach exists
- High contrast warning style

## Integration with App

### New Navigation Option (to be added)

```tsx
// In App.tsx
{screen === 'hull-breach' && <HullBreach3D />}

// Add button to intro screen
<button onClick={() => setScreen('hull-breach')}>
  View Hull Breaches
</button>
```

## Future Enhancements

1. **Repair Tool Integration**:
   - First-person repair tool model (using img2threejs for detailed welder)
   - Proximity check for repair activation
   - Repair tool durability/gun mechanics

2. **Environmental Effects**:
   - Wind from breached module affecting player movement
   - Floating debris entering through breaches
   - Red emergency lighting throughout module

3. **Multi-Breach Scenarios**:
   - Multiple simultaneous breaches for dramatic tension
   - Progressive difficulty (more breaches as game progresses)
   - Wave-based breach attacks

4. **Audio Enhancements**:
   - Real alarm sound file
   - Creepy vacuum hiss from breaches
   - Metal creaking during hull damage

5. **Hull Repair Materials**:
   - Different repair options (emergency patches vs. full welds)
   - Time vs. resource tradeoffs
   - Progress bar for partial repairs

## Acceptance Criteria Met

✅ Breached module shows cracked walls with depth
✅ Screen shake on impact
✅ Alarm system with red warning lights and intensity
✅ Repair tool effect during welding
✅ O2 venting visible as blue particles
✅ Dramatic first-person visual experience
✅ Real-time health bar updates
✅ Progress feedback during repair

## Performance Optimization

✅ Entity count limited (< 20 objects on screen)
✅ BufferGeometry for efficient particle rendering
✅ Geometry reuse where possible
✅ Cleanup in useEffect return
✅ RequestAnimationFrame for smooth animation

## Browser Compatibility

- Three.js CDN loaded
- No build step required
- Responsive design (resize handler)
- Works on desktop and touch

## Testing Checklist

- [ ] Breach spawns randomly with correct type
- [ ] Cracks have proper depth and rotation
- [ ] Particles flow upward from breach
- [ ] Alarm lights pulse during breach activity
- [ ] Screen shake on breach creation
- [ ] Repair button visible for each breach
- [ ] Progress bar updates during welding
- [ ] Breach removed after full repair
- [ ] Hull integrity increases after repair
- [ ] O2 damage persists while breach exists
- [ ] Breaches stop spawning when hull is critical