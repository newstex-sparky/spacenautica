# Screenshot Assets Directory

**Purpose:** Store visual documentation for Spacenautica M2 Station Building
**Date:** July 26, 2026

---

## DIRECTORY STRUCTURE

```
screenshots/
├── m1/
│   └── main_game.png          # M1 survival gameplay
├── m2/
│   ├── builder_menu.png       # Station builder UI
│   ├── module_selection.png   # Active module selection
│   ├── ghost_preview.png      # Ghost module in 3D
│   ├── placed_module_3d.png   # Fully rendered module
│   ├── invalid_placement.png  # Error feedback
│   ├── resource_totals.png    # Resource display
│   ├── key_bindings.png       # Key hints
│   ├── final_station.png      # Complete station layout
│   └── cost_display.png       # Module cost info
└── README.md                  # This file
```

---

## SCREENSHOT DESCRIPTIONS

### **m1/main_game.png**
- **Capture:** Main survival gameplay
- **Content:** Asteroid field, player in first-person, HUD
- **Purpose:** Show base game before M2 features
- **File Size:** Expected: 5-10 MB (PNG)

### **m2/builder_menu.png**
- **Capture:** Full station builder menu overlay
- **Content:** All 6 module buttons, costs, feedback panel
- **Purpose:** Verify UI rendering and layout
- **File Size:** Expected: 3-8 MB (PNG)

### **m2/module_selection.png**
- **Capture:** Active module selection
- **Content:** Highlighted button (Habitat with blue border)
- **Purpose:** Show selection state and color coding
- **File Size:** Expected: 1-3 MB (PNG)

### **m2/ghost_preview.png**
- **Capture:** Ghost module preview in 3D scene
- **Content:** Holographic preview with wireframe edges
- **Purpose:** Verify preview system and movement
- **File Size:** Expected: 5-10 MB (PNG)

### **m2/placed_module_3d.png**
- **Capture:** Module placed on grid
- **Content:** Fully rendered 3D module with glow effect
- **Purpose:** Verify 3D rendering and lighting
- **File Size:** Expected: 5-10 MB (PNG)

### **m2/invalid_placement.png**
- **Capture:** Error feedback message
- **Content:** "✗ Cannot Place Here" in red
- **Purpose:** Verify feedback system
- **File Size:** Expected: 1-3 MB (PNG)

### **m2/resource_totls.png**
- **Capture:** Resource display header
- **Content:** Iron and Ice counts
- **Purpose:** Show real-time resource tracking
- **File Size:** Expected: 1-3 MB (PNG)

### **m2/key_bindings.png**
- **Capture:** Key binding hints
- **Content:** ESC, WASD, 1-6, Click instructions
- **Purpose:** Show user guidance
- **File Size:** Expected: 1-3 MB (PNG)

### **m2/final_station.png**
- **Capture:** Complete station layout
- **Content:** Multiple modules on 10x10 grid
- **Purpose:** Demonstrate station building capabilities
- **File Size:** Expected: 5-15 MB (PNG)

### **m2/cost_display.png**
- **Capture:** Module cost information
- **Content:** Module name, emoji, Iron/Ice costs
- **Purpose:** Verify cost display accuracy
- **File Size:** Expected: 1-3 MB (PNG)

---

## SCREENSHOT CAPTURE INSTRUCTIONS

**Prerequisites:**
1. Server running: http://127.0.0.1:8000/index.html
2. Browser with screenshot capability
3. 10 minutes available

**Steps:**
1. Open http://127.0.0.1:8000/index.html
2. Press **B** to open station builder
3. Use keyboard shortcuts to capture screenshots:
   - **Windows/Linux:** Ctrl+Shift+S, Ctrl+Shift+4
   - **Mac:** Cmd+Shift+4
4. Save each screenshot to appropriate filename
5. Verify all screenshots are sharp and legible

---

## QUALITY REQUIREMENTS

- ✅ **Resolution:** At least 1920x1080 (1080p)
- ✅ **Format:** PNG (lossless)
- ✅ **Quality:** 100%
- ✅ **Text:** Legible (font size ≥ 12px)
- ✅ **Contrast:** Sufficient for readability
- ✅ **Colors:** Match specifications (see ROADMAP.md)
- ✅ **No Blurriness:** Clear, sharp edges
- ✅ **No Clipping:** Important UI elements fully visible

---

## COLOR SPECIFICATIONS

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| Habitat Module | Blue | #4FACFE | Selection, preview, 3D |
| Smelter Module | Orange | #FFA500 | Selection, preview, 3D |
| Refinery Module | Cyan | #4F86F7 | Selection, preview, 3D |
| Solar Panel | Yellow | #FFFF00 | Selection, preview, 3D |
| O2 Generator | Green | #4CAF50 | Selection, preview, 3D |
| Comms Array | Red | #FF4F4F | Selection, preview, 3D |
| Valid Placement | Green | #4CAF50 | Feedback message |
| Invalid Placement | Red | #F44336 | Feedback message |
| UI Background | Dark | rgba(0,0,0,0.85) | Builder menu |
| Text Primary | White | #FFFFFF | All text |
| Text Secondary | Gray | #888888 | Key hints |

---

## SCREENSHOT ORDER

1. **m1/main_game.png** — Start here (base gameplay)
2. **m2/builder_menu.png** — Open B, capture menu
3. **m2/module_selection.png** — Select module, capture button
4. **m2/ghost_preview.png** — WASD movement, capture preview
5. **m2/placed_module_3d.png** — Click to place, capture 3D scene
6. **m2/invalid_placement.png** — Move outside grid, click, capture error
7. **m2/resource_totls.png** — Capture header display
8. **m2/key_bindings.png** — Capture bottom-left hints
9. **m2/cost_display.png** — Select another module, capture cost info
10. **m2/final_station.png** — Place multiple modules, capture grid

---

## POST-PROCESSING

### Recommended Tools
- **Resize:** ImageMagick (`convert -resize 50%` to compress)
- **Optimize:** TinyPNG, ImageOptim (reduce file size)
- **Verify:** Check readability and sharpness

### Suggested Naming
```
spacenautica_m2_builder_menu.png
spacenautica_m2_module_selection.png
spacenautica_m1_survival_gameplay.png
```

---

## STATUS

**Created:** July 26, 2026
**Target:** 10 screenshots for visual documentation
**Expected Deliverable:** Screenshot PNGs in `screenshots/m2/`
**Status:** Waiting for screenshot capture

---

**Next Steps:**
1. Capture all 10 screenshots
2. Verify quality and formatting
3. Add to repository
4. Update README.md with screenshots

---