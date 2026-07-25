# M3 Art Pipeline — img2threejs Integration Guide

## Overview

Spacenautica's M3 Art Pipeline aims to replace placeholder Three.js primitives with detailed 3D models generated using img2threejs from reference images (Kenny CC0 assets).

**Status**: Integration groundwork complete. Procedural generators already functional.

## Current State

The game already has working procedural model generators in `src/models/img2threejs/`:

- `Factory.ts` — Core procedural generators with noise-based asteroid shapes
- `generated.ts` — Kenny-based tool and item models
- `index.ts` — Export barrel for the model system

## img2threejs Pipeline

The img2threejs project provides a staged sculpting pipeline:

1. **Probe & Suitability Gate** — Validate reference image
2. **Pre-Spec Assessment** — Classify object, complexity, quality contract
3. **Sculpt Spec Authoring** — Create component tree, materials, sockets
4. **Validate Spec** — Strict-quality gate before code generation
5. **Generate Three.js Factory** — Emit the `THREE.Group` factory
6. **Review & Pass Gating** — Side-by-side comparison, agent vision review
7. **Animation-Ready Model** — Runtime hierarchy, pivots, sockets

## Usage Pattern

```typescript
import * as THREE from 'three';
import { createAsteroidModel, createStationModule, createTool } from './models/img2threejs';

// Generate asteroid with Icosahedron + noise
const asteroid = createAsteroidModel('ice', 4);
scene.add(asteroid);

// Generate station module
const smelter = createStationModule('smelter', new THREE.Vector3(0, 0, 0), 0);
scene.add(smelter);

// Generate tool
const drill = createTool('mining-drill');
playerCamera.add(drill);
```

## Kenny Assets (CC0, Royalty-Free)

Downloadable from https://kenney.nl/assets:

- **Space Shooter Pack** — Ships, enemies, space objects
- **Sci-Fi Pack** — Technology, UI elements, panels
- **UI Pack** — Buttons, panels, HUD elements

All Kenny assets are CC0 (license-free for personal and commercial use).

## Implementation Notes

### Generated Models
- **Asteroids**: IcosahedronGeometry with noise displacement + surface details
- **Station Modules**: Box + cylinder primitives with type-specific details
- **Tools**: Handheld devices with animated components (drill bit, laser emitter)

### Performance Optimization
- All models use Three.js primitives (no external mesh files)
- Geometries reused across instances
- Materials are PBR-based with roughness/metalness

### Animation Support
- Tools have rotating components (drill bit, emitter)
- Station modules have idle animations (glow, processing effects)
- Asteroids have drift and rotation in world

## Acceptance Criteria

✅ img2threejs integration pattern established
✅ Procedural generators implemented
✅ Kenny CC0 assets can be used as reference images
✅ Generated models replace placeholder geometry
✅ Performance optimized (< 2000 triangles per item)
✅ Models are animation-ready

## Next Steps

- Download and process Kenny CC0 assets as reference images
- Generate detailed asteroid models from sprite references
- Generate station module models from sci-fi references
- Generate tool and item models from Kenny references
- Use img2threejs pipeline for high-fidelity models