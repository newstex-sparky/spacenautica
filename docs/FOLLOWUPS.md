# Outstanding follow-ups

Live list of known gaps, carried between review rounds. Each entry says who owns
it and what "done" looks like. Anything fixed should be deleted from here in the
same commit that fixes it.

## Cross-subsystem

**Promote the band-limiting GLSL helpers into `core/Noise.ts`.**
`world/props/PropShaders.ts` grew a self-contained quartet —
`propFootprint` / `propNyquist` / `propFbm` / `propBump` — while fixing a speckle
artifact whose real cause was a procedural relief normal built from a finite
difference with a step 0.48x the noise period (an aliased secant rather than a
derivative), combined with layers that were never faded out before their period
fell below a pixel. That is a general hazard, not a props one: any subsystem
generating procedural micro-detail in a fragment shader can hit it. The helpers
should move into `core/Noise.ts` as shared GLSL and the copies in props should
delegate. Check `world/terrain` and `assets` for the same class of bug first —
"no normal-map response" on the sea floor looks like the same failure.
Owner: integrator, with terrain + assets.

**Re-capture on an idle machine.** Several subsystem agents could not verify
their work in-engine: eighty-plus concurrent software-GL browsers kept the game
from reaching `__READY__` at all. Capture runs now serialise behind a lock, so a
single clean run is the thing to trust. Any visual finding recorded before that
run should be treated as provisional. Owner: integrator.

**Round-1 findings are partly contaminated.** The frames in
`screenshots/round1/` were photographed after a wall-clock wait that spanned
roughly one rendered frame, so eased and streamed systems were caught
mid-transition. The missing flora and fauna, the featureless terrain and the
wrong biome labels are all consistent with that rather than with real defects.
Re-derive the finding list from a settled capture before assigning more work.
Owner: integrator.

## Relayed to owners, awaiting their pass

**terrain — caustics baseline.** `world/terrain/TerrainMaterial.ts` combines
caustics as `max(c1*c2*2.4 - 0.42, 0)`, which against a unit-mean tile leaves a
baseline near 2.0, so it lifts the whole sea floor instead of dappling it. Prefer
the shared `waterCaustics(worldPos, normal)`; if the local combine is kept it
should be `max(sqrt(c1*c2) - 0.75, 0.0) * 2.6`. Water has already set
`uwCausticsParams.x` so terrain's current exposure is unchanged either way.

**sky — dome fog path length.** `world/sky/SkyDome.ts` computes
`path = uwCameraDepth / max(0.10, abs(rd.y))`, which under-fogs downward rays
given the dome sits 3000 m out. Largely moot now that the water backdrop covers
the dome below a few centimetres of depth; if kept, use a constant around 480.

**sky — publish the panorama to water.** Once the dome renders, call
`water.setSkyTexture(equirect, 1)` on sky-state changes, or the ocean's analytic
sky will not match the atmosphere at the horizon.

**terrain — mid-height flora species.** `boulder_garden` and `sand_dunes` list
only ground-hugging species, so any camera more than ~10 m off the floor sees an
empty world. Flora suggests adding `kelp_short` (0.6) and `coral_tube` (0.35) to
boulder_garden, and `coral_tube` (0.3) to sand_dunes. Every species id already
exists.

**render — prepass depth texture resize.** Relayed directly to the render agent.
three 0.185's `RenderTarget.setSize()` never touches an attached `depthTexture`,
so the prepass FBO goes incomplete on the first adaptive-resolution change and the
driver rejects every operation against it. Confirmed against the installed source.

**flora density vs framing.** Terrain reports that after the flora fill fix,
plants now occlude most of the `02_shallows_floor` frame. Worth judging from a
settled capture before acting: it may be correct density that simply needs a
different camera height, rather than too much flora. Owner: integrator to judge,
then flora if real.

**terrain is calibrated against WaterProfiles Jerlov IA.** The floor's albedo and
tint work was tuned against the water column the water system currently ships. If
the shallows extinction re-thickens, the floor will flatten again — the two are
coupled and neither owns the coupling. Any future change to shallow-water
extinction needs a terrain re-check. Owner: integrator.

## Per-subsystem

**systems** — Creative mode does not auto-unlock the tech tree. Arguably it
should; left alone because the UI agent was concurrently building panels against
`techFrontier()` / `techDepthBlocked()` and emptying those lists would have
pulled the rug out.

**props** — `NearClutter`'s budget is fixed at construction, so a runtime quality
tier change does not resize it.

**audio** — No speech synthesis: `ui:voice` currently gets a radio squelch rather
than a voice. Hull groans key off an enclosure value plus a cave heuristic rather
than real wreck proximity. Vehicle interiors only dampen. No occlusion raycasts.
The generative score is tasteful but has no long-form structure.

**audio (wiring)** — Several cues exist but nothing emits them yet. Other systems
should fire `audio:cue` with `env.wreck` / `env.base` / `env.cave` / `env.open` on
interior transitions (and call `setEnclosure(0..1)`), `tool.scanner` / `knife` /
`mine` / `flashlight` / `seaglide`, `fabricator`, `loop.drill.start` / `.stop`,
`loop.welder.*`, `ui.click` / `ui.hover`, and `creature.<species>` with a
`position`.
