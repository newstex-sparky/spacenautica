#!/usr/bin/env python3
"""Minimal script to create milestone and issue #47"""

import subprocess
import sys
import os
import json

# Check GitHub token
token = os.getenv("GITHUB_TOKEN")
if not token:
    print("ERROR: GITHUB_TOKEN not set")
    sys.exit(1)

# Repo info
owner = "newstex-sparky"
repo = "spacenautica"
api_url = f"https://api.github.com/repos/{owner}/{repo}"

headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}

# Step 1: Create M4 milestone
print("Step 1: Creating M4 milestone...")
payload = {
    "title": "M4: Deep Systems",
    "description": "Endgame progression — tech tree 3D UI, shuttle, signal relay",
    "state": "open",
    "due_on": "2026-08-15T00:00:00Z"
}

cmd = [
    "curl", "-s", "-X", "POST",
    f"{api_url}/milestones",
    "-H", json.dumps({"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}),
    "-d", json.dumps(payload)
]

result = subprocess.run(cmd, capture_output=True, text=True)

try:
    milestone = json.loads(result.stdout)
    print(f"✓ Milestone created: {milestone['title']}")
except Exception as e:
    print(f"⚠️ Could not create milestone: {result.stdout}")
    print(f"Error: {e}")

# Step 2: Create issue #47
print("\nStep 2: Creating issue #47 (Tech tree 3D holographic UI)...")

issue = {
    "title": "[M4] Tech tree 3D holographic UI",
    "body": """## Description
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
- Future: Signal Relay Array implementation after tech unlocks""",
    "milestone": "M4: Deep Systems",
    "labels": ["feature"]
}

cmd = [
    "curl", "-s", "-X", "POST",
    f"{api_url}/issues",
    "-H", json.dumps({"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}),
    "-d", json.dumps(issue)
]

result = subprocess.run(cmd, capture_output=True, text=True)

try:
    issue_data = json.loads(result.stdout)
    print(f"✓ Issue #{issue_data['number']} created: {issue_data['html_url']}")
    print("\nNow implement the tech tree 3D holographic UI as described in issue #47")
except Exception as e:
    print(f"❌ Error creating issue:")
    print(f"STDOUT: {result.stdout[:500]}")
    print(f"STDERR: {result.stderr[:500]}")
    sys.exit(1)