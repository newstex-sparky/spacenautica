# Screenshot Capture Guide — Spacenautica Station Builder

**Purpose:** Capture visual documentation for M2 Station Building
**Target:** Verify all visual elements work correctly
**When to Use:** After opening the game in browser

---

## SETUP

```bash
# Terminal 1: Start server
cd /home/newstex/workspace/spacenautica
python3 -m http.server 8000

# Terminal 2: Monitor file changes
watch -n 1 'stat index.html | grep Size'
```

Then open: **http://localhost:8000/index.html**

---

## SCREENSHOTS TO CAPTURE

### 1. **Main Game View** (M1 Survival Mode)
**Capture:** Normal asteroid mining gameplay
**Purpose:** Verify base game still works
**File:** `main_game_view.png`

### 2. **Station Builder Menu** (M2)
**Steps:**
1. Press **B** key
2. Capture full menu
3. Verify all buttons visible

**Purpose:** Check UI menu appears correctly
**File:** `station_builder_menu.png`

### 3. **Module Selection Buttons**
**Steps:**
1. Press **B** then **1**
2. Verify Habitat button highlighted
3. Check all 6 module buttons

**Purpose:** Verify module selection UI
**File:** `module_selection.png`

### 4. **Cost Display Panel**
**Steps:**
1. Press **B**
2. Capture cost text and icons
3. Verify colors match module colors

**Purpose:** Check cost information display
**File:** `cost_display.png`

### 5. **Ghost Module Preview**
**Steps:**
1. Press **B** then **1** (Habitat)
2. Use **WASD** to move preview
3. Capture ghost module in action
4. Rotate with mouse

**Purpose:** Verify holographic preview works
**File:** `ghost_module_preview.png`

### 6. **Placed Module in 3D Scene**
**Steps:**
1. Press **B**
2. Place module (click)
3. Wait 1 second
4. Capture 3D scene

**Purpose:** Check 3D module rendering
**File:** `placed_module_3d.png`

### 7. **Invalid Placement Feedback**
**Steps:**
1. Press **B**
2. Try placing outside grid (near edges)
3. Capture error message

**Purpose:** Verify feedback system
**File:** `invalid_placement.png`

### 8. **Resource Totals**
**Steps:**
1. Press **B**
2. Capture top-left resource display
3. Verify Iron/Ice numbers

**Purpose:** Check resource tracking
**File:** `resource_totals.png`

### 9. **Key Bindings Hint**
**Steps:**
1. Press **B**
2. Capture bottom-left key hints
3. Verify all key bindings shown

**Purpose:** Check user guidance
**File:** `key_bindings.png`

### 10. **Full Station Build Layout** (Bonus)
**Steps:**
1. Press **B** multiple times
2. Build different modules
3. Capture final station
4. Show grid placement

**Purpose:** Demonstrate station building
**File:** `final_station_layout.png`

---

## SCREENSHOT QUALITY SETTINGS

### Browser Settings
```
Chrome/Edge: F12 → Capture Screenshot
Quality: High (100%)
Format: PNG
Size: Full Page
```

### Screenshot Naming Convention
```
spacenautica_m1_main_game.png
spacenautica_m2_builder_menu.png
spacenautica_m2_module_selection.png
...
```

### Organization
```
spacenautica/screenshots/
├── m1/
│   └── main_game_view.png
├── m2/
│   ├── builder_menu.png
│   ├── module_selection.png
│   ├── cost_display.png
│   ├── ghost_preview.png
│   ├── module_3d.png
│   ├── invalid_feedback.png
│   ├── resource_totals.png
│   ├── key_bindings.png
│   └── final_station.png
```

---

## TEST CHECKLIST

After capturing, verify:

- [ ] All images readable
- [ ] Contrast is clear
- [ ] Text is legible
- [ ] Colors match specifications
- [ ] Grid is visible (if applicable)
- [ ] No blurry text
- [ ] No UI clipping
- [ ] Background not distracting

---

## QUICK SCREENSHOT SCRIPT

Create `capture_screenshots.sh`:

```bash
#!/bin/bash

# Capture all screenshots
SAVE_DIR="screenshots/$(date +%Y%m%d)"

# Create directory
mkdir -p "$SAVE_DIR"

echo "Capturing screenshots to: $SAVE_DIR"
echo "Press B in browser to open station builder"

# Screenshot 1: Main game
echo "1/10: Main game view..."
sleep 3
# Browser screenshot logic here

# Screenshot 2: Builder menu
echo "2/10: Station builder menu..."
# Browser screenshot logic here

# ... continue for all 10 screenshots
```

---

**Created:** July 22, 2026
**Purpose:** Visual documentation and manual testing
**Required:** Browser with screenshot capability