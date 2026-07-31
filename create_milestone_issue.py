#!/usr/bin/env python3
"""Create M4 milestone and issue #47 for tech tree UI"""

import subprocess
import json
import sys

try:
    # Get GitHub repo details
    print("Fetching repo info...")
    result = subprocess.run(
        ["gh", "repo", "view", "--json", "owner,name"],
        capture_output=True,
        text=True,
    )
    repo_info = subprocess.check_output(
        ["gh", "repo", "view", "--json", "owner,name"],
        text=True,
    )
    repo_data = json.loads(repo_info)
    owner = repo_data['owner']['login']
    name = repo_data['name']

    print(f"Repo: {owner}/{name}")

    # Create M4 milestone
    print("\nCreating M4 milestone...")
    result = subprocess.run(
        [
            "gh", "api",
            f"repos/{owner}/{name}/milestones",
            "-X", "POST",
            "-f", "title=M4: Deep Systems",
            "-f", "description=Endgame progression — tech tree 3D UI, shuttle, signal relay",
            "-f", "state=open",
            "-f", "due_on=(2026-08-15T00:00:00Z)"
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        print(f"✓ Milestone created: {result.stdout.strip()}")
    else:
        print(f"⚠️ Could not create milestone: {result.stderr.strip()}")

    # Create issue #47
    print("\nCreating issue #47 (Tech tree 3D holographic UI)...")
    result = subprocess.run(
        [
            "gh", "issue", "create",
            "--title", "[M4] Tech tree 3D holographic UI",
            "--body", """## Description
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
   - "Unlock" button (if requirements met) to spend resources

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
            "--milestone", "M4: Deep Systems",
            "--label", "feature",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        issue = json.loads(result.stdout)
        print(f"✓ Issue #{issue['number']} created: {issue['html_url']}")
        sys.exit(0)
    else:
        print(f"❌ Error creating issue:")
        print(result.stderr)
        sys.exit(1)

except subprocess.CalledProcessError as e:
    print(f"Command failed: {e}")
    sys.exit(1)
except Exception as e:
    print(f"Unexpected error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)