# Spacenautica — 3D Space Survival Game

A playable 3D space survival game built with Three.js that runs directly in the browser with no build step.

## Features

- **First-person 3D camera** with WASD movement and mouse look controls
- **Asteroid mining** with three types of asteroids:
  - Iron ore (gray) — provides Iron resources
  - Water ice (light blue) — provides Ice resources
  - Oxygen crystal (red) — provides emergency O2 refill
- **O2 survival mechanic** — oxygen depletes over time; game over when O2 runs out
- **Resource collection** — mine asteroids to gather resources
- **Particle effects** — explosions when asteroids are destroyed
- **Minimap** — shows nearby asteroids and player position
- **HUD** — displays O2 level, resources, and controls
- **Responsive design** — works on desktop browsers
- **Single-file architecture** — no build step required

## Controls

- **W, A, S, D** — Move forward, left, back, right
- **Mouse** — Look around (after clicking the game to enable pointer lock)
- **Left Click** — Mine asteroids
- **ESC** — Exit pointer lock/pause
- **1** — Show minimap

## Gameplay

1. Start the game by opening `index.html` in a web browser
2. Click anywhere in the game to enable mouse look
3. Use WASD to navigate the asteroid field
4. Aim at asteroids and click to mine them
5. Collect resources to survive and explore
6. Monitor your O2 level — it decreases over time
7. Find oxygen crystal asteroids for emergency O2 refill

## Technical Stack

- **Three.js r128** — 3D WebGL rendering
- **Vanilla JavaScript** — Game logic
- **CSS3** — UI styling
- **No build step** — Simply open in a browser

## Game Mechanics

### Oxygen Survival
- O2 drains at ~1% per second
- Find oxygen crystal asteroids for emergency +25% O2
- When O2 reaches 0%, game over with restart option

### Asteroid Types

| Type | Color | Resource | Health |
|------|-------|----------|--------|
| Iron Ore | Gray | Iron | 3 hits |
| Water Ice | Light Blue | Ice | 3 hits |
| Oxygen Crystal | Red | O2 (+25%) | 1 hit |

### Resource System
- **Iron** — Building material (future use)
- **Ice** — Raw resource for refinement (future use)
- **Oxygen Crystal** — Emergency O2 refill (1 crystal = +25% O2)

## Browser Compatibility

Tested in:
- Chrome/Edge (Chromium)
- Firefox
- Safari

Requires JavaScript and WebGL support in the browser.

## Launch

Simply open `index.html` in a modern web browser. No server required.

For local testing with a simple HTTP server:

```bash
# Python
python3 -m http.server 8000

# Then open http://localhost:8000/index.html
```

## Future Features (Roadmap)

The following features are planned but not yet implemented:

- **M1 — Core Survival Loop:**
  - Smelter module (raw ore → metals)
  - Electrolysis Refinery (water ice → O2 + H2)
  - H2 power grid
  - Player inventory system
  - First-person HUD improvements
  - O2 survival loop refinements
  - Gamepad controls

- **M2 — Station Building:**
  - Station module placement
  - Walk inside pressurized station
  - Airlock transitions
  - 3D crafting UI
  - Hull breaches (passive mode only)

- **M3 — Art Pipeline:**
  - Procedural 3D models using img2threejs

- **M4 — Deep Systems:**
  - Tech tree 3D UI
  - Signal Relay Array (win condition)
  - Shuttle pod vehicle
  - Multi-sector warp

## License

MIT License — Feel free to use and modify for your own projects.

## Credits

Built with **Three.js** by [@mrdoob/threejs](https://github.com/mrdoob/three.js)

Designed and developed as a space survival demonstration game.