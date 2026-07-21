# Issue #36: Station Module Placement (Snap-to-Grid, Adjacency)

**Status:** Partial - needs completion
**Milestone:** M2 — Station Building

## Acceptance Criteria

1. **Snap-to-grid placement** — All built structures snap to a 2x2 grid system
2. **Adjacency rules** — Structures must be placed adjacent to existing modules (or be isolated)
3. **6 module types** — Complete module system with all 6 types:
   - Habitat Dome (1x1)
   - Solar Panel Array (2x1)
   - O2 Generator (1x2)
   - Smelter Module (2x2)
   - Electrolysis Refinery (2x2)
   - Storage Locker (1x1)
4. **Build range** — Can only build within BUILD_RANGE (8 units) of floor point
5. **Resource costs** — Proper costs for all modules (iron, ice, raw ore)

## Current State

The game already has:
- Basic build mode (B key toggle)
- Build preview (holographic)
- tryPlaceStructure function
- 4 module types (dome, solar, o2generator, smelter)

## What's Missing

1. **Grid system** — Current placement uses free-position. Need to implement:
   - Grid size (e.g., 4x4 tiles)
   - Snap coordinates to nearest grid point
   - Collision detection for overlapping structures

2. **Adjacency system** — Need to check if new placement is adjacent to existing structures

3. **Missing module types**:
   - Storage Locker (1x1, iron: 5, ice: 0, rawOre: 0)
   - Electrolysis Refinery (2x2, iron: 0, ice: 15, rawOre: 0)

4. **Build validation** — Check:
   - Within grid bounds (not outside world)
   - No overlapping with existing structures
   - Adjacent to at least one structure (or first build is valid in any location)

## Implementation Plan

1. Add BUILD_GRID_SIZE constant (e.g., 4 units per tile)
2. Update BUILD_TYPES to include missing modules
3. Implement getGridPoint(floorPoint) function
4. Implement hasAdjacentStructure(newPoint) function
5. Update tryPlaceStructure() to use grid-based validation
6. Update build preview to show grid overlay
7. Add UI feedback when placement is invalid (e.g., "Cannot place here - no adjacent module" or "Structure already exists")
8. Test with all 6 module types

## File to Modify

- `src/components/Survival3D.tsx` - Add grid system and validation logic

## Priority

- Grid snap (priority 1)
- Adjacency (priority 2)
- Missing modules (priority 3)

## Notes

- Keep first-person camera and movement (M1 features)
- No combat, no enemies (3D first-person only)
- All M1 features remain functional