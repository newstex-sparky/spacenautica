# Spacenautica — Development Roadmap

> **Last updated:** 2026-07-19
> **Game type:** 3D first-person space survival + base building
> **Engine:** Three.js + React + Vite + TypeScript
> **Rendering:** WebGL first-person only — no 2D, no top-down, no Canvas2D fallback

---

## Game Vision

You wake in a jettisoned escape pod in an asteroid field. O2 is running out. The void is silent.

**Mine asteroids** for raw ore and water ice. **Smelt** ore into metals to build your station. **Split** water ice into O2 to breathe and H2 to power your structures. **Build a signal relay** and broadcast a distress call — if rescue hears you, you win. But you can keep playing.

**One sector** for now (an asteroid field), designed for future multi-sector expansion.

## Resource Model

```
Asteroids (mined in 3D first-person)
├── Raw Ore (gray) → Smelter → Metals → Build structures
└── Water Ice (cyan) → Electrolysis Refinery → O2 (breathe) + H2 (power/fuel)
```

- **Raw Ore**: mined from rocky asteroids, refined in a Smelter → Metals (Iron, Titanium)
- **Water Ice**: mined from ice asteroids, refined in an Electrolysis Refinery → O2 + H2
- **O2**: depletes over time, refills from refinery output or oxygen crystals found in some asteroids
- **H2**: powers station modules (solar panels supplement, but H2 is the main fuel)

## Win Condition (Hybrid)

1. **Survive** — manage O2, don't suffocate
2. **Build** — smelt ore → metals → construct station modules (habitat, smelter, refinery, solar, O2 generator)
3. **Tech up** — unlock the Signal Relay Array via tech progression
4. **Broadcast** — build the relay array, power it with H2, send the distress signal
5. **Rescue** — ending sequence plays, but sandbox mode continues indefinitely

## Tone

**Passive survival** — no combat, no enemies. The void is calm but unforgiving. Future expansion may add environmental hazards in specific areas (solar flares in near-star sectors, debris storms in wreckage sectors), but the starting sector is peaceful. The tension comes from O2 management and resource scarcity, not threats.

---

## Milestones

### M1 — Core Survival Loop ✅ (done)

The basic 3D first-person survival experience. Mine, breathe, build.

|| Issue | Title | Status |
|-------|-------|--------|
| #28 | Three.js scene with first-person camera | ✅ Done |
| #30 | 3D asteroids with dual resource types (Iron Ore, Water Ice, Oxygen Crystal) | ✅ Done |
| #31 | First-person HUD (O2, resources, minimap, compass) | ✅ Done |
| #32 | Gamepad controls (6DOF WASD + analog sticks) | ✅ Done |
| #33 | O2 survival loop (depletion, game over, respawn, inventory) | ✅ Done |

**All M1 issues complete. Proceed to M2.**

### M2 — Station Building

Build a real station with connected modules, walk inside, use crafting.

**Priority order:** #36 → #37 → #38 → #39

|| Issue | Title | Status |
|-------|-------|--------|
| #36 | Station module placement (snap-to-grid, adjacency, 6 module types) | ✅ Done |
| #37 | Walk inside pressurized station | ❌ Not started |
| #38 | Airlock transition (vacuum ↔ pressurized) | ❌ Not started |
| #39 | 3D crafting UI at fabricator | ❌ Not started |

### M3 — Art Pipeline

Generate detailed 3D models from reference images using img2threejs.

| Issue | Title | Status |
|-------|-------|--------|
| #41 | Integrate img2threejs | ❌ Not started |
| #42 | Asteroid models via img2threejs | ❌ Not started |
| #43 | Station module models via img2threejs | ❌ Not started |
| #44 | Tool and item models via img2threejs | ❌ Not started |
| #45 | Kenny CC0 assets as reference images | ❌ Not started |

### M4 — Deep Systems

Endgame progression — tech tree, sectors, shuttle vehicle.

| Issue | Title | Status |
|-------|-------|--------|
| #46 | Multi-sector warp travel | ❌ Deferred — one sector for now, design for expansion |
| #47 | Tech tree 3D holographic UI | ❌ Not started |
| #48 | Shuttle pod vehicle | ❌ Not started |

**New issues needed:**
- Signal Relay Array (the win condition structure)
- Distress broadcast sequence (ending)
- Solar flare / debris storm hazards (future sectors only)

---

## Tech Stack

- **Three.js** — WebGL 3D rendering
- **React** — UI components and state management
- **Vite** — build tool and dev server
- **TypeScript** — type safety
- **GitHub Pages** — deployment (auto from `main` branch)
- **img2threejs** — procedural model generation from reference images (M3)

## File Structure

```
src/
├── App.tsx                    # Main app, intro screen, screen routing
├── components/
│   ├── Survival3D.tsx         # Main 3D game component (first-person)
│   ├── NarratorScene.tsx      # Signal questline (future integration)
│   └── HullBreach3D.tsx       # Hull breach mini-game (future)
├── styles/
│   └── game.css               # All UI styles
└── main.tsx                   # React entry point
```

## Cron Agent

The "Spacenautica Issue Worker" cron job runs every 60 minutes, picks up the highest-priority open issue, implements it in 3D first-person, builds, commits, and closes the issue. It is instructed to never add combat or 2D code.