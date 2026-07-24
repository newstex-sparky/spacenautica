#!/usr/bin/env python3
import subprocess
import sys

def create_issue(title, body, milestone_title):
    """Create a GitHub issue with the given title, body, and milestone"""
    cmd = [
        "gh", "api", "repos/newstex-sparky/spacenautica/issues", "-X", "POST",
        "-f", "title=" + title,
        "-f", "body=" + body,
        "-f", f'milestone={milestone_title}'
    ]
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode == 0:
        print(f"✓ Created issue: {title}")
        return True
    else:
        print(f"✗ Failed issue: {title} - {result.stderr}", file=sys.stderr)
        return False

# M3 Art Pipeline issues
issues = [
    {
        "title": "[M3] Integrate img2threejs skill for procedural 3D model generation",
        "body": """## Goal

Integrate the img2threejs skill into the Spacenautica project workflow. This will enable procedural generation of detailed 3D models from reference images (Kenny CC0 sprites, concept art, screenshots).

## Success Criteria

- img2threejs skill is installed as a submodule/skill
- Documentation explains the workflow: reference image -> procedural Three.js model -> integration into Survival3D.tsx
- Example shows creating one object model (asteroid) via img2threejs and using it in the game

## Tech Notes

- img2threejs creates TypeScript factory functions (e.g., `createAsteroidModel()`)
- Output should be a `src/models/` directory with model factory exports
- Models should be animation-ready with pivots, colliders, and runtime hierarchy
- Use img2threejs SKILL.md references: browser-screenshot-feedback.md, action-ready-models.md
"""
    },
    {
        "title": "[M3] Asteroid models via img2threejs",
        "body": """## Goal

Generate detailed asteroid models for all three asteroid types using img2threejs from reference images.

## Success Criteria

- **Iron Ore asteroids**: gray, rocky appearance with metallic veins
- **Water Ice asteroids**: cyan/white, icy crystalline surface
- **Oxygen Crystal asteroids**: glowing red crystals embedded in ice rock
- Each model is a function `createAsteroidModel(type)` returning a THREE.Group
- Models include:
  - Procedural geometry (not just primitives)
  - Proper materials (PBR metallic/roughness for iron, icy specular for water ice)
  - Collision geometry (AABB or custom collision mesh)
  - Runtime hierarchy with pivot at asteroid center
  - Animation-ready (destroy effects, mining feedback)
- All models integrated into Survival3D.tsx, replacing simple spheres/cylinders

## Reference Images

Kenny CC0 space/asteroid sprite as reference. Use `img2threejs/assets/` or download from Kenny's store.

## Files to Create

- `src/models/asteroids.ts` -- export `createAsteroidModel(type)`
- `src/models/ModelTypes.ts` -- update to include asteroid model types
"""
    },
    {
        "title": "[M3] Station module models via img2threejs",
        "body": """## Goal

Generate detailed station module models using img2threejs from reference images.

## Success Criteria

6 module types with procedural geometry and details:
- **Dome (habitat)**: transparent pressure vessel with internal living quarters, airlock doors, internal lighting
- **Solar Panel**: flexible photovoltaic array frame with solar cells, support struts, mounting point
- **O2 Generator**: cylindrical production unit with oxygen gas vents, processing pipes, control panel
- **Smelter**: industrial furnace unit, conveyor belts (animated), raw ore input hopper, metal output chute
- **Refinery**: electrolysis unit with ice input, H2 output, O2 output, cooling systems
- **Storage (locker/storage)**: secure metal storage cabinet, locking mechanism, shelf details

Each model:
- Function `create{ModuleType}Model()` returning THREE.Group
- Proper materials (metallic, glass, wireframe, illuminated panels)
- Collision geometry (hitbox for each module)
- Runtime hierarchy with mounting points (for adjacency connections)
- Interior view meshes (for walkable pressurized modules: dome, o2generator, storage)

## Reference Images

Kenny CC0 sci-fi station module sprites.

## Files to Create

- `src/models/stationModules.ts` -- export `create{Dome|Solar|O2Generator|Smelter|Refinery|Storage}Model()`
"""
    },
    {
        "title": "[M3] Tool and item models via img2threejs",
        "body": """## Goal

Generate detailed game tool and item models using img2threejs from reference images.

## Success Criteria

Tools and items with procedural geometry and interactions:
- **Mining Drill**: handheld drill with rotating bit, handle grip, power cable, laser sight
- **Oxygen Tank**: scuba-style cylinder with regulator valve, carrying strap, pressure gauge
- **Storage Locker**: metal cabinet with locking latch, storage compartments, hazard stripes
- **Crafting Table (Fabricator)**: workbench surface with blueprint display, tool slots, power connector
- **Power Cell (H2 Battery)**: portable power storage cylinder with charging port, status LED
- **Signal Relay**: antenna array with signal dish, transmitter housing, cable connections

Each model:
- Function `createToolModel(type)` returning THREE.Group
- Proper materials (metallic, plastic, glow effects for energy)
- Interactive elements (drill bit rotation animation, power cell charging glow)
- Collision geometry (tool hitbox, cell collection area)
- Runtime hierarchy with attachment sockets (for hand-held tools)

## Reference Images

Kenny CC0 handheld tools and equipment sprites.

## Files to Create

- `src/models/tools.ts` -- export `createToolModel(type)`
"""
    },
    {
        "title": "[M3] Kenny CC0 assets as reference images",
        "body": """## Goal

Download and integrate Kenny CC0 sprite assets as reference images for img2threejs procedural model generation.

## Success Criteria

- Kenny CC0 sprite pack for space shooter/Sci-fi scenes (Kenny's "Space Shooter" or "Sci-Fi" pack)
- Sprite assets organized in `img2threejs/assets/kenny-sprites/`:
  - Space shooter sprites (asteroids, enemies, weapons, UI)
  - Sci-fi sprites (stations, tools, equipment, HUD)
  - Environmental sprites (debris, stars, asteroids with textures)
- Readme documents sprite license (CC0) and usage (reference only, not direct sprite rendering)

## Assets to Obtain

From Kenny's asset store or free pack:
- Space Shooter pack: asteroids, bullets, enemies
- Sci-Fi pack: stations, tools, equipment, UI elements
- Any additional environment sprites needed for other issues (#42-#44)

## Files to Create

- `img2threejs/assets/kenny-sprites/README.md` -- sprite pack documentation with license and usage guide
- Asset organization: folder structure with sprite files and image dimensions
"""
    }
]

# Create all M3 issues
print("Creating M3 Art Pipeline issues...")
print("=" * 60)
for issue in issues:
    create_issue(issue["title"], issue["body"], "M3: Art Pipeline")

print("=" * 60)
print("Done!")