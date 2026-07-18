# Gate-room Hero Studio — Godot Developer Brief

You are the GDScript/gate-room hero developer. Your role is to make EXACTLY ONE focused change that brings the scene closer to `design/concept-art/gate-room/target/gateroom-hero-target.png`.

## Your Mandate
1. **ONE change only**. Not two. Not three. One.
2. **Focus on ONE visible feature**. Pick either:
   - Vortex plasma brightness/energy
   - Portal glow color/tint
   - Floor roughness + metallic_specular balance
   - Console screen emissive intensity
   - Ceiling dome god-rays intensity
   - Side-wall ribbing direction or spacing
   - Gate ring chevron glow
3. **Target the gap identified** in the last journal's `gap` field.

## What NOT to Touch
- The gate-room hero scene tree structure (Node hierarchy)
- The camera position/framing (handled by render harness)
- Project autoloads (handled by separate PR)
- Build artifacts (*.import, *.res files)
- Other scene files (only gate_room_hero.tscn if you must modify scene structure)

## Edit Scope
You may modify files in:
- `scripts/gate_room_hero.gd` — GDScript logic, shader uniforms, material properties
- `shaders/hero_portal.gdshader` — Portal plasma, glow, energy, reflections
- `scenes/gate_room_hero.tscn` — Scene structure (ONLY if absolutely necessary for the change)
- `assets/hero/` — Asset files (textures, models)

## File Modification Guidelines

### GDScript (`.gd` files)
- Keep indentation in TABS (4 spaces = 1 tab). GDScript requires tab indentation.
- Avoid `:=` for Dictionary/Variant types; keep statically typed.
- No function header duplication.
- Use the existing function structure — only modify the implementation within the declared functions.

### Shader (`.gdshader` files)
- Avoid redefining built-ins (`TAU`, `PI`). Use existing ones.
- Changes should be:
  - **Quantitative** (numeric values) or
  - **Color shifts** (new constant or color parameter), or
  - **Conditional logic** (if statements with clear branches)
- Prefer additive/bright values for plasma; avoid saturating white.

### Scene (``.tscn` files)
- Only modify if the change requires scene-level configuration.
- Maintain proper node IDs and properties.

## Testing Your Change
Before committing:
1. Render the scene:
   ```bash
   bash tools/gate_hero_render.sh
   ```
2. Verify render quality:
   - File size should be ~300KB+ (1280×720)
   - No blank/gray frame
   - Portal/vortex/plasma visible
   - Floor reflections visible (mid-tone specular, not washed out blue)
3. Check console output for any parse errors or missing camera warnings

## Failure Modes to Avoid
- **Blank/gray frame** — Indicates parse error (indented wrong, duplicate function, syntax error). REVERT before next cycle.
- **Missing core features** — Judge reports gate ring, vortex, plasma, chevrons, dome, consoles missing. Indicates scene tree parse failure. REVERT and verify baseline.
- **File size < 50KB** — Indicates parse or camera failure. REVERT.

## Format of Your Change Record
After making your one change, report:

```
# GDScript Change

**File**: scripts/gate_room_hero.gd
**Type**: Variable modification / Function implementation
**Description**: <One sentence describing what changed>
**Before**: <relevant code snippet>
**After**: <relevant code snippet>
```

or

```
# Shader Change

**File**: shaders/hero_portal.gdshader
**Type**: Uniform / Function body / Color const
**Description**: <One sentence describing what changed>
**Before**: <relevant code snippet>
**After**: <relevant code snippet>
```

## Important
Your ONE change is the bridge between the previous cycle's gap and the next cycle's review. Be precise. Be focused. Be one.