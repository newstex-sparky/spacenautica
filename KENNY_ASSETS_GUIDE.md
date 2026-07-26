# Kenny CC0 Assets Integration Guide

## Overview
This document describes how to integrate Kenny CC0 assets as reference images for the img2threejs procedural model generation pipeline in Spacenautica.

## Asset Sources (All CC0, Royalty-Free)

### Available Kenny Packs
1. **Space Shooter Remastered** (295 assets) — ships, enemies, power-ups
   - URL: https://kenney.nl/assets/space-shooter-remastered
   - Format: ZIP download

2. **Space Kit** (150 assets) — space-themed UI elements, decorations
   - URL: https://kenney.nl/assets/space-kit
   - Format: ZIP download

3. **UI Pack** (430 assets) — buttons, panels, icons, health bars
   - URL: https://kenney.nl/assets/ui-pack
   - Format: ZIP download

4. **Space Shooter Extension** (270 assets) — additional ships and enemies
   - URL: https://kenney.nl/assets/space-shooter-extension
   - Format: ZIP download

## Download Process

### Automated Download (Python Script)
Run the following script to download and extract Kenny assets:

```bash
cd /home/newstex/workspace/spacenautica
python3 download_kenny_assets.py
```

This script will:
- Download the four Kenny asset packs to `assets/` directory
- Extract all images to `assets/images/`
- List all extracted image files for reference

### Manual Download
1. Visit each Kenny asset pack URL above
2. Download the ZIP file to `assets/` directory
3. Extract the ZIP to `assets/`
4. All images will be in `assets/images/` after extraction

## Integration with img2threejs

### Step 1: Select Reference Images
Choose at least 5 reference images from the downloaded assets that will be converted into 3D models:

**Priority Images for Spacenautica:**
1. Shuttle pod reference (from Space Shooter Remastered)
2. Station module reference (from Space Kit or Space Shooter Remastered)
3. Mining tool reference (from Space Shooter Remastered)
4. HUD element reference (from UI Pack)
5. Environmental detail reference (asteroid fragments, debris from Space Kit)

### Step 2: Run img2threejs Pipeline
For each reference image, run the img2threejs sculpting pipeline:

```bash
cd /home/newstex/workspace/spacenautica
# Run the staged pipeline for a reference image
node -e "
const { execSync } = require('child_process');
// Replace with your image path
const imagePath = 'assets/images/shuttle-pod-reference.png';
execSync('python3 img2threejs/scripts/new_sculpt_spec.py \"Shuttle Pod\" --image ' + imagePath + ' --complexity moderate --out sculpt_specs/shuttle-pod.json');
"
```

### Step 3: Review Generated Models
Each sculpt pass generates:
- TypeScript code: `src/models/createShuttlePodModel.ts`
- Screenshots for visual comparison

Review each pass to ensure the model matches the reference image.

### Step 4: Replace Placeholder Geometry
Update Survival3D.tsx to use the generated models:

```typescript
// Import generated models
import { createShuttlePodModel } from '../models/createShuttlePodModel';

// Replace placeholder meshes with generated models
const shuttlePod = createShuttlePodModel();
scene.add(shuttlePod);
```

## Usage in Spacenautica

Once integrated, Kenny asset-based models will enhance visual fidelity:

1. **Shuttle Pod** — Detailed 3D shuttle model for vehicle mechanics
2. **Station Modules** — Procedural station components
3. **Mining Tools** — Enhanced drill and scanner models
4. **HUD Elements** — 3D holographic UI components
5. **Environmental Objects** — Asteroid fragments, debris, debris clouds

## Credits
All Kenny assets are provided under CC0 (Creative Commons Zero) license.

**Credits in README:**
```
Assets by Kenney (kenney.nl) — CC0
```

## Example Workflow

1. Download Kenny assets using `download_kenny_assets.py`
2. Extract `assets/images/` directory
3. Choose 5 reference images (see Priority Images above)
4. Run img2threejs sculpting pipeline for each image
5. Review generated models in browser
6. Integrate successful models into Survival3D.tsx
7. Update build menus and UI to use new models

## Next Steps

Once Kenny assets are integrated:
- Test visual fidelity improvements
- Run build and verify no rendering issues
- Document any performance impact
- Update issue #45 acceptance criteria completion notes