# Spacenautica — Design Document

> A Subnautica-style survival game set in space. Instead of an ocean planet, you're stranded in the vacuum after your colony ship catastrophically jumped into an uncharted system. Build space stations, mine asteroids, manage O2, and unravel the mystery of what pulled your ship off course.

---

## The Twist

Subnautica has you survive underwater on an alien planet. **Spacenautica** replaces water with **vacuum**. The same core survival loop — O2 management, habitat building, resource gathering, exploration, danger escalation — maps perfectly:

| Subnautica | Spacenautica |
|---|---|
| Oxygen underwater | Oxygen in vacuum (EVA suit) |
| Build underwater bases | Build space stations |
| Mine seabed resources | Mine asteroids |
| Seamoth / Cyclops vehicles | EVA jetpack / shuttle pod |
| Leviathan predators | Void leviathans, pirate drones |
| Depth pressure | Hull integrity vs. radiation/debris |
| Biomes (kelp, reef, void) | Sectors (ice belt, nebula, debris field, core) |
| Radiation suit | Shielded suit, hull plating |
| Aurora wreck | Derelict colony ship *Meridian* |
| PDA crafting | Fabricator (3D printer) |
| Power: solar/thermal/nuclear | Solar panels / RTG / reactor |

---

## Storyline (Expandable)

### Act 1 — Stranded
The colony ship *Meridian* was carrying 10,000 settlers to a new world. 37 jumps from home, a massive gravity anomaly pulled the ship off course and tore it apart. You wake in a jettisoned escape pod with 30 minutes of O2. Your first task: survive. Reach a nearby asteroid, establish a breathable habitat, and scavenge wreckage from the Meridian.

### Act 2 — The Signal
After stabilizing, you detect a repeating signal from deeper in the system. It's not human. Following it leads you to ancient alien ruins embedded in a massive asteroid — a derelict gateway built by a civilization that vanished. The gateway is what pulled the Meridian off course. You must repair it.

### Act 3 — The Choice
The gateway can send you home — or to wherever the aliens went. The system's sun is destabilizing. You must decide: go home with what you know, or follow the aliens into the unknown. Either way, you need to survive long enough to choose.

### Future Expansion Hooks
- Other survivors (NPC crew, merchant convoys)
- Pirate factions that raid your station
- Alien biotech that lets you breathe in vacuum temporarily
- Building a fleet, moving your station to new sectors
- Multiplayer co-op station building

---

## Tech Tree (Vast & Expandable)

### Tier 0 — Survival (Escape Pod)
- [x] EVA Suit (baseline, 30 min O2)
- [ ] Emergency Air Tank (+15 min O2)
- [ ] Solar Panel (passive power)
- [ ] O2 Generator (converts power → O2)
- [ ] Repair Tool (fix hull breaches)
- [ ] Scanner (scan resources/ruins)

### Tier 1 — Basic Station
- [ ] Habitat Module (4x4 pressurized room)
- [ ] Airlock (enter/exit station safely)
- [ ] Power Cable (connect solar → station)
- [ ] Storage Locker
- [ ] Fabricator (basic crafting)
- [ ] Beacon (mark locations)
- [ ] Jetpack Mk1 (faster EVA movement)

### Tier 2 — Industrial
- [ ] Mining Laser (extract ore from asteroids)
- [ ] Ore Processor (refine raw ore → bars)
- [ ] Habitat Corridor (connect modules)
- [ ] Reinforced Hull (survive debris impacts)
- [ ] Battery Bank (store excess power)
- [ ] Comms Array (contact other survivors)
- [ ] Radiation Suit (enter irradiated sectors)

### Tier 3 — Deep Space
- [ ] Shuttle Bay (build + launch small ships)
- [ ] Scanner Array (reveal sector maps)
- [ ] Shield Generator (protect station from debris)
- [ ] RTG (Radioisotope Thermoelectric Generator — always-on power)
- [ ] Thermal Extractor (mine rare crystals)
- [ ] Hull Repair Bay (auto-repair station)
- [ ] Jetpack Mk2 (EVA boost + dash)

### Tier 4 — Advanced
- [ ] Fission Reactor (massive power)
- [ ] Mass Driver (launch cargo pods)
- [ ] Drone Bay (autonomous mining drones)
- [ ] Habitat Dome (large pressurized area, farm crops)
- [ ] Fusion Reactor (endgame power)
- [ ] Alien Artifact Scanner (detect alien tech)
- [ ] Vacuum Walker (survive in vacuum indefinitely — no O2 timer)

### Tier 5 — Endgame
- [ ] Gateway Reactivation (win condition)
- [ ] Gravity Drive (move your entire station)
- [ ] Alien Biotech Lab (craft alien enhancements)
- [ ] Emergency Evacuation Fleet
- [ ] Deep Core Mining (planet-breaking scale)
- [ ] Stellar Engine (stabilize the dying sun)

---

## Core Gameplay Loop

1. **Survive** — Manage O2, power, and hull integrity. Always running out.
2. **Explore** — Fly EVA to nearby asteroids and wreckage. Scan resources.
3. **Mine** — Extract ore, crystals, and alien materials from asteroids.
4. **Build** — Construct station modules, connect them, pressurize.
5. **Craft** — Use the fabricator to turn ore → tools → better gear.
6. **Upgrade** — Unlock new tech via the tech tree.
7. **Progress** — Follow the signal deeper into the system.
8. **Decide** — Repair the gateway and choose your ending.

---

## Survival Mechanics

### Oxygen
- Base EVA suit: 30 minutes (real-time countdown, accelerated ~60x game speed)
- Inside a pressurized station: O2 refills automatically
- Air tanks, O2 generators extend EVA time
- Running out of O2 = game over (respawn at station)

### Power
- Solar panels generate power during "day" (facing the star)
- Batteries store excess; power runs O2 generators, fabricators, shields
- Running out of power = O2 stops = death if in space

### Hull Integrity
- Station modules have hull integrity (0-100%)
- Debris impacts, radiation, and attacks reduce integrity
- Hull breaches vent O2 — repair immediately or suffocate
- Reinforced hulls take less damage

### Hazards
- **Debris fields** — random impacts, hull damage
- **Radiation sectors** — require radiation suit
- **Solar flares** — disable solar panels temporarily
- **Void leviathans** — large predators that attack stations and EVA
- **Pirate drones** — roving hostile drones that salvage your resources

---

## Controller-First Design

Gamepad support is primary, keyboard/mouse is secondary:
- **Left stick** — Move (EVA jetpack thrust / walk in station)
- **Right stick** — Aim mining laser / look around
- **A/X** — Primary action (mine / interact / build)
- **B/Circle** — Cancel / exit
- **Y/Triangle** — Inventory
- **X/Square** — Build menu
- **LB/RB** — Cycle hotbar
- **LT** — O2 tank boost (emergency)
- **RT** — Mining laser / tool fire
- **Start** — Tech tree / pause
- **Select** — Map

Touch controls (mobile) mirror gamepad: virtual joystick + action buttons.

---

## Architecture

Same proven React + Vite + Canvas 2D tilemap pattern from Space Harvest:

```
src/
  main.tsx           — Entry point
  App.tsx            — React UI: screens, modals, start screen
  styles/game.css    — Mobile-first CSS
  engine/
    types.ts         — All TypeScript interfaces
    items.ts         — Resource, tool, module, recipe definitions
    techTree.ts      — Tech tree definitions + unlock logic
    World.ts         — Sector generation, asteroid fields, station tiles
    Player.ts        — Player entity, EVA movement, O2, inventory
    GameEngine.ts    — Central game loop, action handlers, survival
  components/
    GameCanvas.tsx   — Canvas renderer
    HUD.tsx           — O2 bar, power, hull, sector, clock
    TouchControls.tsx — Joystick + action buttons (also reads gamepad)
    InventoryModal.tsx
    BuildModal.tsx    — Station module placement
    CraftModal.tsx    — Fabricator recipes
    TechTreeModal.tsx — Tech tree progression
    MapModal.tsx      — Sector map
```

---

## Development Phases

### Phase 1 — Core Survival (MVP) ← we are here
- EVA movement in space (2D top-down)
- O2 countdown system
- Asteroid mining (basic)
- Place first habitat module
- Refill O2 inside station
- Basic inventory + crafting
- Controller + touch controls
- GitHub Pages deployment

### Phase 2 — Station Building
- Full module placement system
- Airlock mechanics
- Power system (solar → battery → O2 generator)
- Hull integrity + breaches
- Corridor connections
- Storage

### Phase 3 — Exploration & Tech
- Multiple sectors (travel between)
- Tech tree unlock system
- Jetpack upgrades
- Shuttle pod vehicle
- Scanner / beacon system
- Resource variety (rare ores, crystals, alien materials)

### Phase 4 — Story & Danger
- Signal questline
- Alien ruins
- Void leviathan encounters
- Pirate drone attacks
- Radiation/debris hazards
- Derelict Meridian exploration

### Phase 5 — Endgame
- Gateway repair questline
- Station relocation (gravity drive)
- Multiple endings
- Fleet building
- Stellar engine