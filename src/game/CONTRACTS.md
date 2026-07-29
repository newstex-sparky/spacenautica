# Spacenautica engine contracts

**Read this before touching any file under `src/game/`.** Sub-agents work in
parallel on disjoint directories; these contracts are the only coupling between
them. Do not change a signature listed here without saying so loudly.

## Hard rules

1. **File ownership is exclusive.** Only edit files inside the directory you
   were assigned. Never edit `src/game/core/**` (shared spine) or another
   module's directory. If you need something from another module, use the
   documented accessor or the `EventBus`.
2. **No external assets.** There is no CDN, no texture pack, no glTF download.
   *Every* texture, mesh, sound and animation is generated procedurally at
   runtime from code. This is a hard constraint, not a preference.
3. **TypeScript must compile**: `npx tsc --noEmit` and `npm run build` must both
   pass when you finish. `strict` is on.
4. **Honour quality tiers.** Read `ctx.settings.graphics` and scale your work.
   `ctx.settings.at('high')` is a convenient "at least high" test.
5. **Dispose what you allocate.** Implement `dispose()` for every geometry,
   material, and render target.
6. **Frame budget.** Nothing in `update()` may allocate per-frame objects in a
   loop. Reuse scratch vectors declared at module scope.
7. **Everything is metric.** 1 unit = 1 metre. Sea level is `y = 0`; the world
   below is negative Y. Depth is `-y`.

## Registration

Each module exports a class implementing `GameSystem` from `core/Types.ts`:

```ts
export class MySystem implements GameSystem {
  readonly name = 'world.terrain';
  readonly phase = Phase.World;
  init(ctx: GameContext) {}
  update(dt: number, ctx: GameContext) {}
  resize(w: number, h: number, ctx: GameContext) {}
  dispose() {}
}
```

`src/game/main.ts` constructs and registers them in order. Cross-system access:
`ctx.get<WaterSystem>('world.water')`.

## Two hazards that have already cost real time

**Do not stream, place or cull against `ctx.camera` from a phase before
`Phase.Camera`.** `player.camera` writes the camera transform in `Phase.Camera`,
so anything running in `Phase.World` or earlier reads *last frame's* viewpoint.
This is harmless while the camera drifts and catastrophic when it jumps: flora
placed and culled plants for the previous vantage point, and fauna culled its
entire population on a teleport. Both now use `ctx.get<PlayerSystem>('player')
.position` (or their own cached eye vector) instead. If you need the view
direction rather than the position, cache it yourself at the end of your own
update.

**Presentation timers must not use the `dt` handed to `update()`.** That value is
clamped (`Math.min(raw, 1/15)`) so a stall cannot teleport the player, which is
correct for simulation and wrong for anything a human watches. Under software
rendering, where a frame can take over a second, interface timing driven by the
clamped `dt` runs roughly 21x slow — a HUD depth damper eased 132 m in one frame
and five-second toasts took 105 s to expire. Use `ctx.rawDt` (unclamped) or a real
wall clock for dwell, fade and easing; keep simulation and survival clocks on
`dt`.

## System table

| name | dir | phase | owner module |
|---|---|---|---|
| `assets.textures` | `assets/` | PreUpdate | procedural PBR texture + material library |
| `world.sky` | `world/sky/` | PreRender | sun/moon, atmosphere, day-night, weather |
| `world.terrain` | `world/terrain/` | World | chunked LOD sea floor, biomes, installs `ctx.world` |
| `world.water` | `world/water/` | PreRender | surface, underwater volumetrics, caustics |
| `world.flora` | `world/flora/` | World | instanced kelp, coral, grass |
| `world.props` | `world/props/` | World | rocks, wrecks, POIs, resource nodes, vents |
| `fauna` | `fauna/` | Simulation | boids, creatures, predator AI |
| `player` | `player/` | Physics | swim controller, vitals |
| `player.camera` | `player/` | Camera | head bob, shake, FOV kick |
| `player.viewmodel` | `player/` | Camera | first-person hands + tools |
| `game.state` | `systems/` | Gameplay | inventory, crafting, tech, scanner, quests, save |
| `game.build` | `systems/` | Gameplay | base building |
| `ui.hud` | `ui/` | UI | HUD, PDA, menus (DOM overlay) |
| `audio` | `audio/` | UI | procedural WebAudio |
| `render.post` | `render/` | PreRender | post stack; sets `engine.renderOverride` |

## Public APIs other systems depend on

### `assets.textures` — `TextureLibrary`
```ts
/** Returns a cached procedural PBR map set, generating on first request. */
get(id: TextureId, size?: number): PbrMaps;         // { map, normalMap, roughnessMap, aoMap, displacementMap? }
/** A 1x1 white / flat-normal fallback, always available synchronously. */
readonly white: THREE.Texture;
readonly flatNormal: THREE.Texture;
/** Blue-noise texture (RGBA, tiling 128px) for dithering and TAA jitter. */
readonly blueNoise: THREE.Texture;
```
`TextureId` is a string union declared in `assets/TextureIds.ts`. Other modules
may add ids there — that file is shared, append-only, no reordering.

### `world.sky` — `SkySystem`
```ts
readonly sunDirection: THREE.Vector3;   // normalised, points *toward* the sun
readonly sunColor: THREE.Color;         // linear, already attenuated by air mass
readonly sunIntensity: number;          // lux-ish scalar for the directional light
readonly moonDirection: THREE.Vector3;
readonly ambientColor: THREE.Color;
timeOfDay: number;                      // 0..24 hours, writable
dayLength: number;                      // real seconds per in-game day
readonly environment: THREE.Texture;    // PMREM env map for IBL, refreshed lazily
readonly stormFactor: number;           // 0..1, drives surface chop + light loss
readonly sunLight: THREE.DirectionalLight;
```

### `world.terrain` — `TerrainSystem`
Installs `ctx.world` (see `WorldQuery` in `core/Types.ts`) during `init`.
```ts
readonly seed: number;
/** Highest and lowest floor height in the loaded region, for LOD/fog tuning. */
readonly bounds: { min: number; max: number };
/** Registered biome definitions, keyed by id. */
readonly biomes: ReadonlyMap<string, BiomeDef>;
/** Raycast against the loaded terrain chunks. Cheap: uses the heightfield. */
raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): THREE.Vector3 | null;
```
`BiomeDef` lives in `world/terrain/Biomes.ts` and is imported by flora, fauna,
props and audio for placement rules. Its shape:
```ts
interface BiomeDef {
  id: string; name: string;
  depthRange: [number, number];       // metres below sea level
  floorColor: THREE.Color;            // albedo tint
  fogColor: THREE.Color;              // linear
  fogDensity: number;                 // per-metre extinction at this biome
  ambientLight: number;               // 0..1 multiplier
  flora: Array<{ id: string; density: number }>;
  fauna: Array<{ id: string; density: number }>;
  music: string;
}
```

### `world.water` — `WaterSystem`
```ts
readonly underwater: boolean;             // is the *camera* below the surface
readonly cameraDepth: number;             // metres below the surface, >= 0
surfaceHeightAt(x: number, z: number, t: number): number;
/** Extinction + inscatter for a given depth; used by every underwater shader. */
scatteringAt(depth: number, out: { extinction: THREE.Vector3; inscatter: THREE.Color }): void;
/** Animated caustics texture; null above water or on low quality. */
readonly causticsTexture: THREE.Texture | null;
/** Uniform block shared into terrain/flora/props materials via onBeforeCompile. */
readonly sharedUniforms: Record<string, THREE.IUniform>;
```
**Any material that renders underwater geometry must mix in
`WaterSystem.sharedUniforms` and the fog chunk from `world/water/UnderwaterFog.ts`**
so a single change to water colour propagates everywhere.

### `player` — `PlayerSystem`
```ts
readonly position: THREE.Vector3;   // eye position, world space
readonly velocity: THREE.Vector3;
readonly yaw: number; readonly pitch: number;
readonly depth: number;             // metres below sea level, >= 0
readonly inVehicle: string | null;
readonly vitals: { oxygen: number; maxOxygen: number; health: number; food: number; water: number };
readonly swimming: boolean; readonly sprinting: boolean; readonly grounded: boolean;
/** Applied by creatures/explosions; the controller integrates it. */
addImpulse(v: THREE.Vector3): void;
damage(amount: number, source: string): void;
teleport(pos: THREE.Vector3): void;
```

### `game.state` — `GameState`
```ts
readonly inventory: Inventory;      // systems/Inventory.ts
readonly crafting: Crafting;
readonly tech: TechTree;
readonly scanner: Scanner;
readonly quests: QuestLog;
readonly databank: Databank;
save(slot?: string): void;
load(slot?: string): boolean;
```

### `ui.hud` — `HudSystem`
Pure DOM overlay above the canvas. Reads other systems, never mutates world
state directly — it emits bus events instead.

### `render.post` — `PostStack`
Sets `engine.renderOverride`. Reads `ctx.settings.graphics` every frame and
enables/disables passes. Exposes:
```ts
readonly composer: EffectComposer;
/** Depth+normal targets other systems (water, god rays) may sample. */
readonly depthTexture: THREE.DepthTexture;
readonly normalTexture: THREE.Texture;
setFocusDistance(d: number): void;
addScreenShake(amount: number, duration: number): void;
```

## Visual target

The reference is Subnautica (2018) and Subnautica: Below Zero at max settings.
Concretely, every scene must exhibit:

- **Depth-graded water**: colour shifts from turquoise near the surface through
  teal to near-black by 300 m, with *wavelength-dependent* extinction (red dies
  first). No uniform-colour `THREE.Fog`.
- **God rays** that move with the sun and get occluded by geometry.
- **Caustics** on the sea floor and on the player's hands, attenuated by depth
  and by what's above.
- **Marine snow** particulate with parallax and near-field bokeh.
- **Surface interface** visible from below: total internal reflection near the
  horizon, a bright refraction disc overhead (Snell's window).
- **Physically-based materials**: no flat-shaded primitives, no untextured
  `MeshStandardMaterial` with a solid colour. Everything carries albedo,
  normal, roughness and AO variation at multiple scales.
- **Silhouette variety**: no repeated identical meshes visible in one frame.
  Instances vary in scale, rotation, colour and shape parameters.
- **Motion everywhere**: kelp sways on a current field, fish school, particulate
  drifts, light dapples. A still frame should still read as a living world.
