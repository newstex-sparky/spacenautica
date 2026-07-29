# Spacenautica — 3D Space Survival Game

A complete 3D first-person space survival and base-building game built with Three.js + React + TypeScript. No build step required for local play.

## Features

### Core Survival (M1) ✅ COMPLETE
- **First-person 3D camera** — WASD movement, mouse look with pointer lock
- **Asteroid mining** — Three asteroid types:
  - Iron ore (gray) — Provides Iron resources
  - Water ice (light blue) — Refinable into O2 + H2
  - Oxygen crystal (green) — Emergency O2 refill (+25 O2)
- **O2 survival loop** — Oxygen depletes over time, game over when O2 reaches 0
- **Resource collection** — Mine asteroids to gather Iron, Ice, O2
- **Particle effects** — Explosions on asteroid destruction
- **Minimap** — Shows player position and nearby asteroids
- **HUD** — Displays O2 level, resources, controls, build mode

### Station Building (M2) ✅ COMPLETE
- **9 station modules**:
  - Habitat Dome (1x1, pressurized space)
  - Solar Panel (2x1, passive H2 generation)
  - O2 Generator (1x2, generates O2 from H2)
  - Smelter (2x2, converts ore → metals)
  - Electrolysis Refinery (2x2, water ice → O2 + H2)
  - Fabricator (2x2, craft tools/upgrades)
  - Storage Locker (1x1, stores raw materials)
  - H2 Storage Tank (1x1, powers station)
  - Signal Relay Array (4x4, win condition)
- **Build mode** — WASD movement in build mode, left click to place
- **Snap-to-grid placement** — 4-unit tile system
- **Pressurized station interior** — Walk inside modules
- **3D crafting UI** — Select structures via hotkeys (1-9, R)

### Art Pipeline (M3) ✅ COMPLETE
- **Procedural 3D models** via img2threejs (asteroids, modules, tools)
- **Kenny CC0 assets** — Reference sprites for detailed procedural models
- **Visual polish** — Lighting, shadows, fog, particle effects

### Deep Systems (M4) 🚧 IN PROGRESS
- **Tech tree 3D UI** — Interactive holographic interface
- **Shuttle pod vehicle** — Launch/entry system
- **Signal Relay Array** — Win condition structure with broadcast sequence
- **Distress broadcast** — 30-second transmission triggers rescue ship

## Controls

**Movement (gameplay):**
- WASD — Move forward/left/back/right
- Mouse look (after pointer lock)
- Left click — Mine asteroid / Place structure

**Build mode:**
- WASD — Move near placement area
- Left click — Place selected structure
- 1-9 or R — Select structure type

**Gameplay mode:**
- ESC — Pause / Exit pointer lock

## Gameplay Loop

### Survival Phase
1. Mine asteroids for Iron and Ice resources
2. Mine Oxygen crystals for emergency O2
3. Monitor O2 level — it depletes over time (1 O2/sec)
4. Find Oxygen Crystal asteroids for +25 O2 refill (emergency)

### Build Phase
1. Place station modules on the asteroid surface
2. Construct Smelter to refine ore → metals
3. Build O2 Generator to generate breathable air
4. Build Electrolysis Refinery to split water ice → O2 + H2
5. Build H2 Storage Tank to power station modules
6. Build Signal Relay Array (cost: 20 Iron, 10 H2)

### Win Condition
1. Build Signal Relay Array (4x4 module)
2. Power it with H2 fuel (2 H2/sec required)
3. Stand near relay and press the "BROADCAST" button
4. Wait 30 seconds for distress signal
5. Rescue ship arrives and docks
6. Ending sequence plays (sandbox continues)

## Tech Stack

- **Three.js r128+** — 3D WebGL rendering
- **React 18+** — UI component system
- **TypeScript** — Type-safe game code
- **Vite** — Build tool (optional, not required for local play)
- **img2threejs** — Procedural 3D model generation
- **Kenny CC0 assets** — Reference sprites

## Development Setup

### Local Play (No Build)
Simply open `index.html` in a modern browser:
```bash
# Python
python3 -m http.server 8000

# Then open http://localhost:8000/index.html
```

### Development Build
```bash
npm install
npm run build
```

## Roadmap Status

**M1 — Core Survival Loop:** ✅ Complete
- All survival mechanics working
- Asteroid mining, O2 survival, HUD complete

**M2 — Station Building:** ✅ Complete
- 9 module types implemented and tested
- Build mode, interior walkthrough, crafting UI complete

**M3 — Art Pipeline:** ✅ Complete
- Procedural 3D models generated
- Visual polish complete

**M4 — Deep Systems:** 🚧 Partial
- Tech tree UI: ✅ Complete
- Shuttle pod: ✅ Complete
- Signal Relay Array: ✅ Implemented, under testing
- Multi-sector warp: ⏸️ Deferred (one sector for now)

## Browser Compatibility

Tested in:
- Chrome/Edge (Chromium) 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

Requires:
- JavaScript enabled
- WebGL support
- Modern browser with ES6+ support

## License

MIT License — Feel free to use and modify for your own projects.

## Credits

Built with **Three.js** by [@mrdoob/threejs](https://github.com/mrdoob/three.js)

Designed and developed as a space survival demonstration game following the browser-game-development skill patterns.