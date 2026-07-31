#!/bin/bash

OWNER="newstex-sparky"
REPO="spacenautica"

echo "Creating M4 milestone..."
gh api "repos/$OWNER/$REPO/milestones" -X POST \
  -f "title=M4: Deep Systems" \
  -f "description=Endgame progression — tech tree 3D UI, shuttle, signal relay" \
  -f "state=open" \
  -f "due_on=(2026-08-15T00:00:00Z)" > /dev/null

echo "Creating issue #47..."

# Create temporary issue description file
ISSUE_BODY_FILE=$(mktemp)

cat > "$ISSUE_BODY_FILE" << 'EOF'
## Description
Create a 3D holographic UI for the tech tree at the player's base.

### Goal
- Display unlockable technologies in a 3D holographic tree
- Player can navigate the tree interactively (UI buttons + 3D selection)
- Clicking a node shows tech details and prerequisites
- Techs include: Signal Relay, Hull Modules, Life Support, Shuttle Docking

### Key Features
1. **3D Holographic Display**
   - Tree of tech nodes arranged in 3D space (horizontal plane)
   - Holographic shader effect (glow, transparency)
   - Nodes glow when unlocked, dim when locked
   - Lines connect tech nodes

2. **Tech Categories**
   - Base Systems (Solar Panels, H2 Tanks)
   - Life Support (O2 Generator, Recycling)
   - Production (Smelter, Refinery)
   - Advanced (Signal Relay, Hull Breach Systems)

3. **UI Integration**
   - Toggleable holographic overlay (hotkey or button)
   - Click-to-select tech nodes in 3D
   - Detail panel shows: name, cost, unlock prerequisites, description
   - Unlock button (if requirements met) to spend resources

4. **Resource Costs**
   - Each tech has required resources (H2, Metals)
   - Check player inventory before allowing unlock
   - Visual feedback when not enough resources

### Technical Requirements
- Three.js scene overlaying the player's base
- Raycasting to detect clicks on tech nodes
- Holographic shader material (custom shader or built-in)
- Tech tree data structure (nodes, connections, dependencies)
- Responsive design for HUD layout

### Acceptance Criteria
- [ ] Tech tree visible in 3D over base when opened
- [ ] Player can click to select and view tech details
- [ ] Tech nodes glow/illuminate correctly
- [ ] Unlock button works with valid resource balance
- [ ] UI toggle works (show/hide holographic tree)
- [ ] Holographic shader effects visible
- [ ] Tech dependencies enforced (cannot unlock without prerequisites)
- [ ] Tech list matches roadmap categories (Base, Life Support, Production, Advanced)
- [ ] No 2D Canvas or top-down fallback
- [ ] Works in first-person camera mode

### Related Issues
- Closes #47 (this issue)
- Depends on M1-M3 completion
- Future: Signal Relay Array implementation after tech unlocks
EOF

gh issue create \
  --title "[M4] Tech tree 3D holographic UI" \
  --body-file "$ISSUE_BODY_FILE" \
  --milestone "M4: Deep Systems" \
  --label "feature"

# Cleanup
rm -f "$ISSUE_BODY_FILE"

echo "✓ Issue #47 created successfully"
echo "Now proceed to implement the tech tree 3D holographic UI"