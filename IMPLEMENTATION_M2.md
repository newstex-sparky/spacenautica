# M2 Station Building Implementation

**Feature Branch:** `feature/m2-station-building`  
**Status:** In Progress  
**Date:** July 22, 2026

---

## M2 STATION BUILDING FEATURES

### Phase 1: Station Building UI & Module Placement ✅ Design Complete

#### #36: Station Module Placement
**Status:** Design Complete → Implementation In Progress

**6 Station Module Types:**
1. **Habitat Module** — Pressurized living space
2. **Smelter** — Refine raw ore into metals
3. **Electrolysis Refinery** — Split water ice into O2 + H2
4. **Solar Panel** — Generate power from sunlight
5. **O2 Generator** — Produce oxygen from water
6. **Comms Array** — Build signal relay for distress call

**Module Specifications:**
```javascript
const STATION_MODULES = {
    habitat: {
        name: 'Habitat Module',
        icon: '🏠',
        color: 0x4FACFE,  // Blue
        size: 20,
        cost: { iron: 50, ice: 30 },
        description: 'Pressurized living space'
    },
    smelter: {
        name: 'Smelter',
        icon: '🔥',
        color: 0xFFA500,  // Orange
        size: 18,
        cost: { iron: 40, ice: 20 },
        description: 'Refine ore into metals'
    },
    refinery: {
        name: 'Electrolysis Refinery',
        icon: '💧',
        color: 0x4F86F7,  // Cyan
        size: 18,
        cost: { ice: 50 },
        description: 'Split water into O2 + H2'
    },
    solar: {
        name: 'Solar Panel',
        icon: '☀️',
        color: 0xFFFF00,  // Yellow
        size: 16,
        cost: { iron: 30 },
        description: 'Generate power from sunlight'
    },
    o2gen: {
        name: 'O2 Generator',
        icon: '💚',
        color: 0x4CAF50,  // Green
        size: 16,
        cost: { ice: 40 },
        description: 'Produce oxygen from water'
    },
    comms: {
        name: 'Comms Array',
        icon: '📡',
        color: 0xFF4F4F,  // Red
        size: 22,
        cost: { iron: 60, ice: 40 },
        description: 'Build signal relay'
    }
};
```

**Grid System:**
```javascript
const GRID_SIZE = 10;  // 10x10 station grid
const GRID_SPACING = 5;  // World units between grid points
const SNAP_TO_GRID = true;  // Snap modules to grid
```

**Placement Validation:**
```javascript
function isValidPlacement(moduleType, x, z) {
    // Check if position is within grid bounds
    if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return false;

    // Check if grid cell is already occupied
    const gridCell = grid[Math.floor(x)][Math.floor(z)];
    if (gridCell !== null && gridCell !== moduleType) return false;

    // Check adjacency rule (optional)
    if (!canPlaceAdjacent(x, z)) return false;

    return true;
}
```

**Placement Preview (Holographic):**
- Shows ghost module at mouse cursor position
- Indicates placement validity (green = valid, red = invalid)
- Displays module cost overlay
- Shows energy consumption tooltip

---

#### #37: Walk Inside Pressurized Station (Future)

**Status:** Pending Phase 2

**Implementation Plan:**
- Change camera view from external to internal when inside station modules
- Pressurized zone detection: Detect when camera is within module bounding box
- Zone colors: Vacuum (black/transparent) ↔ Pressurized (blue-tinted space)

**Walk Navigation:**
- WASD movement restricted to module interiors
- Collision detection with module walls
- Internal lighting (soft glow from habitat modules)
- Atmospheric sound effects

---

#### #38: Airlock Transition (Future)

**Status:** Pending Phase 4

**Implementation Plan:**
- Airlock structure with vacuum ↔ pressurized zones
- Pressure change animation: Air hiss, camera shake, visual fog
- Safe passage: 30-second countdown before pressurization
- Emergency ejection (if depressurized too quickly)

---

#### #39: 3D Crafting UI at Fabricator (Future)

**Status:** Pending Phase 2

**Implementation Plan:**
- Fabricator machine with 3D model
- Crafting menu overlay with 3D item previews
- Material requirement display (iron, ice, metals, H2, O2)
- Progress bar and sound feedback
- Slot-based inventory UI

---

## UI OVERLAY DESIGN

### Station Builder Menu
```html
<div id="station-builder-menu">
    <div class="menu-header">
        <h2>🚀 Station Builder</h2>
        <div class="stats">
            <span>Iron: <strong id="iron-display">0</strong></span>
            <span>Ice: <strong id="ice-display">0</strong></span>
        </div>
    </div>

    <div class="module-grid">
        <button onclick="selectModule('habitat')">
            🏠 Habitat Module<br>
            <small>50 Iron | 30 Ice</small>
        </button>
        <button onclick="selectModule('smelter')">
            🔥 Smelter<br>
            <small>40 Iron | 20 Ice</small>
        </button>
        <!-- ... other modules ... -->
    </div>

    <div class="actions">
        <button onclick="exitBuilder()">Exit Builder</button>
    </div>
</div>
```

### Holographic Preview
```html
<div id="module-preview" class="holographic-preview">
    <div class="preview-3d"></div>
    <div class="preview-info">
        <h3 id="module-name">Habitat Module</h3>
        <p id="module-desc">Pressurized living space</p>
        <div class="cost">
            <span class="material">⚡ Iron: 50</span>
            <span class="material">❄️ Ice: 30</span>
        </div>
    </div>
</div>
```

### Placement Feedback
```html
<div id="placement-feedback" class="feedback">
    <div class="status valid">✓ Valid Placement</div>
    <div class="status invalid">✗ Cannot Place Here</div>
    <div class="tooltip">
        <h4 id="tooltip-module">Habitat Module</h4>
        <p>Cost: 80 total resources</p>
    </div>
</div>
```

---

## TECHNICAL IMPLEMENTATION

### Phase 1 Tasks (Current)

1. **✅ UI Overlay Integration**
   - Add station builder menu to HTML
   - Implement module selection system
   - Display resource costs

2. **✅ Grid System**
   - Create 10x10 invisible grid in 3D space
   - Implement snap-to-grid math
   - Grid coordinate mapping

3. **✅ Module Placement System**
   - Add module placement state to gameState
   - Create `placeStructure()` function
   - Validation logic (bounds, occupancy, cost)

4. **✅ Visual Preview**
   - Ghost module at cursor position
   - Validity highlighting (green/red)
   - Cost display overlay

5. **✅ Module Storage**
   - Track placed modules in gameState
   - Module array: `stationModules: []`
   - Module coordinates: `x, z`

6. **✅ Resource Cost Check**
   - Verify player has required materials
   - Deduct cost on placement
   - Show error if insufficient resources

7. **✅ Module Rendering**
   - Create 3D geometry for each module type
   - Module materials and textures
   - Module lighting (glow effects)

---

## GAMEPLAY FLOW

### Starting the Builder
1. Press **E** (or click "Enter Builder" button) to open station builder
2. Station builder UI appears over 3D scene (faded)
3. Cursor changes to placement mode
4. Ghost module appears at current camera position

### Placing a Module
1. Use **WASD** to move ghost module around
2. **Mouse scroll** or **+/-** to select module type
3. **Click** to place (if valid placement)
4. Module snaps to nearest grid point
5. Resources deducted
6. Module appears in station

### Building Strategies
- **Core:** Habitat + Smelter (center) — Start here
- **Resource Loop:** Smelter → Habitat → Refinery → Habitat
- **Power:** Solar panels around perimeter
- **Life Support:** O2 Generator near habitat

### Station Organization
1. **Core Modules:** Habitat, Smelter, Refinery (central cluster)
2. **Power Generation:** Solar panels (outer ring)
3. **Support:** O2 Generator, Comms Array (edge)

---

## COMPLETION CRITERIA

### Phase 1 Criteria ✅
- [ ] UI overlay displays correctly
- [ ] Module selection works (6 modules available)
- [ ] Grid snaps modules to 10x10 positions
- [ ] Placement validation works (bounds, occupancy)
- [ ] Resource cost deduction works
- [ ] Visual preview ghost module works
- [ ] Invalid placement rejected with feedback
- [ ] Placed modules render in 3D scene
- [ ] Module array stores all placed modules
- [ ] Exit builder returns to normal gameplay

---

## FUTURE PHASES

### Phase 2: Station Interaction
- [ ] Walk inside station modules
- [ ] Pressurized zone detection
- [ ] Internal camera transitions
- [ ] Internal lighting

### Phase 3: Crafting System
- [ ] 3D fabricator machine
- [ ] Crafting menu UI
- [ ] 3D item previews
- [ ] Progress bar and sounds

### Phase 4: Airlock System
- [ ] Airlock structure in 3D
- [ ] Vacuum ↔ pressurized zones
- [ ] Pressure change animation
- [ ] Safe passage countdown

---

## FILES TO CREATE/UPDATE

### New Files:
1. `src/js/station-builder.js` — Station builder logic
2. `src/js/module-data.js` — Module configuration data
3. `src/js/grid-system.js` — Grid utility functions
4. `src/css/station-builder.css` — Builder UI styles

### Existing Files to Update:
1. `index.html` — Add UI overlay and canvas references
2. `style.css` — Add builder-specific styles
3. `game.js` — Integrate builder functions

---

## TESTING PLAN

### Manual Testing Steps:
1. Start game (http://localhost:8000/index.html)
2. Press 'B' to open station builder
3. Select Habitat module
4. Move ghost module and click to place
5. Verify placement on grid
6. Repeat for other modules
7. Verify resources deducted
8. Try invalid placement (outside grid, occupied)
9. Verify error feedback
10. Exit builder and continue normal gameplay

### Automated Tests:
```javascript
test('ModulePlacement: isValidPlacement returns correct results', () => {
    expect(isValidPlacement('habitat', 0, 0)).toBe(true);
    expect(isValidPlacement('habitat', 10, 0)).toBe(false); // out of bounds
    expect(isValidPlacement('habitat', 0, 0)).toBe(false); // already occupied
});

test('ModulePlacement: costDeduction reduces resources correctly', () => {
    gameState.iron = 50;
    gameState.ice = 30;
    placeStructure('habitat', 0, 0);
    expect(gameState.iron).toBe(0);
    expect(gameState.ice).toBe(0);
});

test('ModulePlacement: invalidPlacement shows feedback', () => {
    selectModule('habitat');
    placeStructure(11, 5); // outside grid
    expect(feedbackElement.textContent).toContain('Invalid placement');
});
```

---

## NOTES

- **M1** survival mechanics remain unchanged
- **M2** station building is additive, not replacement
- **Player starts with no station** — must build from scratch
- **Station building optional** — can play pure survival indefinitely
- **Station modules have durability** (optional future feature)

---

**Next Action:** Begin Phase 1 implementation (UI + Module Placement)