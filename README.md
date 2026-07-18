# Spacenautica

> A Subnautica-style space survival game. Instead of an ocean planet, you're stranded in the vacuum of space after your colony ship catastrophically jumped into an uncharted system.

[**Play the game →**](https://newstex-sparky.github.io/spacenautica/)

## The Twist

Subnautica has you survive underwater on an alien planet. **Spacenautica** replaces water with **vacuum**. The same core survival loop — O2 management, habitat building, resource gathering, exploration, danger escalation — maps perfectly to space.

## Features

- 🚀 **EVA Survival** — Manage oxygen, power, and health in the vacuum of space
- ⛏️ **Asteroid Mining** — Extract iron, gold, crystal, silicon, carbon, uranium, and alien alloys
- 🏗️ **Station Building** — Construct habitat modules, airlocks, corridors, solar panels, O2 generators, fabricators, reactors, and more
- 🧪 **Vast Tech Tree** — 6 tiers from basic survival to stellar engines
- 🏭 **Crafting** — Refine ore into materials, craft tools, build modules
- 🎮 **Controller-First** — Full gamepad support (Xbox/PS5), keyboard, and touch controls
- 📱 **Mobile Ready** — Virtual joystick + action buttons work on any touch device
- 🌌 **Storyline** — 3-act narrative with expandable hooks for future content

## Controls

| Input | Gamepad | Keyboard | Touch |
|-------|---------|----------|-------|
| Move | Left stick | WASD/Arrows | Virtual joystick |
| Mine | RT | F/J | 🔥 button |
| Action | A | Space/Enter | ✋ button |
| Cancel | B | Esc | — |
| Inventory | Y | I | 🎒 button |
| Build | X | B | 🔨 button |
| Craft | Select | C | 🏭 button |
| Tech Tree | Start | T | 🧪 button |
| Map | LB | M | 🗺️ button |
| Boost | LT | Shift | — |

## Tech Stack

- **React 18** + **TypeScript** — UI and game logic
- **Vite 5** — Build tooling
- **HTML5 Canvas 2D** — Rendering (no external rendering libs)
- **No build-time assets** — All rendering is procedural (shapes, gradients, dots)

## Architecture

```
src/
  main.tsx              — Entry point
  App.tsx               — React app: screens, modals, start screen
  styles/game.css       — Mobile-first CSS
  engine/               — Pure TypeScript game logic
    types.ts            — All interfaces
    items.ts            — Resources, tools, modules, recipes
    techTree.ts         — Tech tree definitions + unlock logic
    World.ts            — Sector generation, asteroid fields, station tiles
    Player.ts           — Player entity, EVA movement, O2, inventory
    GameEngine.ts       — Central game loop, survival, mining, building, crafting
  components/
    GameCanvas.tsx      — Canvas renderer (space, asteroids, player)
    HUD.tsx             — O2/power/health bars, hotbar, time
    TouchControls.tsx  — Joystick + action buttons + gamepad polling
    Modals.tsx          — Inventory, Build, Craft, TechTree, Map modals
```

## Development

```bash
npm install
npm run dev      # Start dev server on port 8002
npm run build    # Build for production
npm run preview  # Preview production build
```

## Roadmap

See [PLAN.md](./PLAN.md) for the full design document with storyline, tech tree, and 5-phase development roadmap.

## License

Code: MIT
Assets: CC0 (Kenny)

## Credits

Built by Sparky (Hermes Agent) for the Spacenautica project.