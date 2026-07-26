# SCREENSHOT CAPTURE — Spacenautica M2 Station Building

**Date:** July 26, 2026
**Server:** ✅ Running (http://127.0.0.1:8000/index.html)
**Status:** Ready for manual screenshot capture

---

## SETUP INSTRUCTIONS

```bash
# Ensure server is running
cd /home/newstex/workspace/spacenautica
python3 -m http.server 8000

# In another terminal, monitor for updates
watch -n 1 'stat index.html | grep Size'

# Open browser to: http://127.0.0.1:8000/index.html
```

---

## SCREENSHOT TARGETS

### 1. Main Game View (M1 Survival)
**Capture:** Asteroid field with player in first-person view
**Purpose:** Show base gameplay before opening station builder
**File:** `screenshots/m2/main_game.png`

**Action:**
1. Open http://127.0.0.1:8000/index.html
2. Wait 2 seconds for scene to load
3. Capture full screen
4. Verify: Asteroids visible, O2 bar showing, no station builder

---

### 2. Station Builder Menu
**Capture:** Full station builder UI overlay
**Purpose:** Show all module buttons and UI elements
**File:** `screenshots/m2/builder_menu.png`

**Action:**
1. Press **B** on keyboard (or click "Exit Builder" button if exists)
2. Wait for menu to appear
3. Capture full menu container
4. Verify: All 6 module buttons visible, cost display visible, background blur

**Expected UI:**
```
🚀 Station Builder
⚡ Iron: [display] ❄️ Ice: [display]

Select Module:
[🏠 Habitat] [🔥 Smelter]
[💧 Refinery] ☀️ [Solar]
[💚 O2 Generator] 📡 [Comms Array]

Selected: Habitat Module
🏠 Habitat Module
Iron: 50 | Ice: 30

✓ Valid Placement / ✗ Cannot Place Here
Instructions: 1. Select | 2. Move WASD | 3. Click

[Exit Builder] [Place Module]
```

---

### 3. Module Selection Highlight
**Capture:** Module button with active selection
**Purpose:** Show which module is selected (highlighted)
**File:** `screenshots/m2/module_selection.png`

**Action:**
1. Press **B** to open menu
2. Press **1** (or click Habitat button)
3. Capture Habitat button (highlighted with blue border)
4. Verify: Active button border = 2px solid #4FACFE, other buttons = 1px solid #444

**Highlight State:**
- Border: `2px solid #4FACFE` (blue)
- Background: `rgba(79, 172, 254, 0.3)`
- Other buttons: `1px solid #444`, `rgba(255, 255, 255, 0.05)`

---

### 4. Ghost Module Preview
**Capture:** Ghost module preview in 3D space
**Purpose:** Show holographic preview with WASD movement
**File:** `screenshots/m2/ghost_preview.png`

**Action:**
1. Press **B** then **1** (select Habitat)
2. Use **W** key to move preview forward
3. Move mouse to rotate camera
4. Wait 1 second
5. Capture 3D scene with ghost module

**Ghost Module Visual:**
- Color: Holographic blue (#4FACFE)
- Transparency: 0.3
- Wireframe edges: White, 0.5 opacity
- Positioned at camera location

---

### 5. Placed Module in 3D Scene
**Capture:** Fully rendered module on grid
**Purpose:** Show 3D module with glow effect
**File:** `screenshots/m2/placed_module_3d.png`

**Action:**
1. Press **B** then **1** (Habitat)
2. Click to place (mouse click)
3. Wait 1 second
4. Capture 3D scene

**Placed Module Visual:**
- Geometry: Box 20x10x20
- Material: Standard material, gray/blue
- Color: Matches module type (Habitat = #4FACFE)
- Glow effect: Sphere 6x6x6, 0.3 opacity, same color
- Position: Aligned to grid

---

### 6. Invalid Placement Feedback
**Capture:** Error message for invalid placement
**Purpose:** Show feedback system working
**File:** `screenshots/m2/invalid_placement.png`

**Action:**
1. Press **B** then **1** (Habitat)
2. Move ghost module outside grid (near edges)
3. Click to place
4. Capture error message

**Error Message:**
- Text: "✗ Cannot Place Here"
- Color: Red (#F44336)
- Tooltip: "Outside grid bounds" or "Cell already occupied"

---

### 7. Resource Totals
**Capture:** Resource display in station builder header
**Purpose:** Show real-time resource tracking
**File:** `screenshots/m2/resource_totals.png`

**Action:**
1. Press **B** to open menu
2. Capture top-left resource display
3. Verify: Iron and Ice numbers displayed

**Resource Display:**
```
🚀 Station Builder
⚡ Iron: [display] ❄️ Ice: [display]
```
- Updates automatically when modules placed
- Displays current resource count from M1 gameplay

---

### 8. Key Bindings Hint
**Capture:** Key binding instructions
**Purpose:** Show user guidance
**File:** `screenshots/m2/key_bindings.png`

**Action:**
1. Press **B** to open menu
2. Capture bottom-left key hints
3. Verify: All controls listed

**Key Bindings:**
```
Key Bindings:
[ESC] Exit Builder
[WASD] Move Preview
[1-6] Select Module
[Click] Place Module
```
- Font size: 12px
- Color: #888
- Background: rgba(0, 0, 0, 0.7)

---

### 9. Full Station Layout (Advanced)
**Capture:** Multiple modules placed in grid
**Purpose:** Show station building capabilities
**File:** `screenshots/m2/final_station.png`

**Action:**
1. Press **B** multiple times to place several modules
2. Select different modules (1, 2, 3, etc.)
3. Click to place each
4. Capture final grid layout

**Example Layout:**
- Row 0: Habitat, Smelter
- Row 1: Refinery, Solar
- Row 2: O2 Generator, Comms Array
- Grid visible with grid lines

---

### 10. Module Cost Display
**Capture:** Cost text with current module
**Purpose:** Show module specifications
**File:** `screenshots/m2/cost_display.png`

**Action:**
1. Press **B** then **3** (Refinery)
2. Capture cost text panel
3. Verify: Module name, emoji, costs

**Cost Display:**
```
Selected: Refinery
💧 Electrolysis Refinery
Iron: 0 | Ice: 50
```

---

## SCREENSHOT QUALITY SETTINGS

### Browser Settings (Chrome/Edge)
1. Press **F12** to open DevTools
2. Right-click page → "Capture screenshot"
3. Choose:
   - "Save as..." (save to disk)
   - "Capture screenshot" → "Save as..." (region capture)

### Keyboard Shortcuts
- **Windows/Linux:**
  - **Ctrl+Shift+S** → Save full page screenshot
  - **Ctrl+Shift+4** → Select region to capture

- **Mac:**
  - **Cmd+Shift+4** → Select region to capture
  - **Cmd+Shift+3** → Capture full screen

### Recommended Settings
- **Format:** PNG (lossless, better quality)
- **Quality:** 100%
- **Resolution:** Native screen resolution
- **Aspect Ratio:** 16:9 (default monitor)

---

## FILE ORGANIZATION

Create directory structure:

```
spacenautica/screenshots/
├── m1/
│   └── main_game.png
├── m2/
│   ├── builder_menu.png
│   ├── module_selection.png
│   ├── ghost_preview.png
│   ├── placed_module_3d.png
│   ├── invalid_placement.png
│   ├── resource_totls.png
│   ├── key_bindings.png
│   ├── final_station.png
│   └── cost_display.png
└── date.txt
```

---

## SCREENSHOT NAMING CONVENTION

```
spacenautica_{phase}_{feature}.{format}

Example:
spacenautica_m2_builder_menu.png
spacenautica_m2_module_selection.png
spacenautica_m1_main_game.png
```

---

## QUICK SCREENSHOT SCRIPT (Optional)

Create `capture_screenshots.sh`:

```bash
#!/bin/bash

SAVE_DIR="screenshots/m2"

mkdir -p "$SAVE_DIR"

echo "Capturing Spacenautica M2 screenshots..."

# Screenshot 1: Builder menu
echo "1/10: Builder menu..."
sleep 2
# Browser: Ctrl+Shift+S and manually save as $SAVE_DIR/builder_menu.png

# Screenshot 2-10: Similar pattern...
# ...

echo "All screenshots captured to: $SAVE_DIR"
```

---

## POST-SCREENSHOT PROCESSING

### Recommended Tools
- **Viewer:** ImageMagick, IrfanView, Preview
- **Editor:** Photoshop, GIMP, Canva
- **Compressor:** TinyPNG, ImageOptim

### Suggested Enhancements
1. **Crop** to remove browser chrome
2. **Enhance** contrast slightly
3. **Add** red circle highlighting features
4. **Crop** to remove non-essential UI elements
5. **Save** as both PNG (quality) and WEBP (smaller)

---

## TESTING CHECKLIST

After capturing, verify:

- [ ] All images readable and sharp
- [ ] Text is legible (module names, costs, messages)
- [ ] Colors match specifications (#4FACFE for Habitat, etc.)
- [ ] Contrast is adequate
- [ ] No blurry elements
- [ ] No UI clipping
- [ ] Background isn't distracting
- [ ] Ghost preview shows wireframe edges
- [ ] Placed modules show glow effects

---

## UPLOAD TO REPOSITORY

After capturing screenshots:

```bash
cd /home/newstex/workspace/spacenautica
git add screenshots/
git commit -m "feat: Add M2 station building screenshots documentation"
git push origin main
```

---

**Created:** July 26, 2026
**Purpose:** Visual documentation for M2 Station Building
**Required:** Browser with screenshot capability, Manual testing

**Status:** ✅ Ready for manual screenshot capture