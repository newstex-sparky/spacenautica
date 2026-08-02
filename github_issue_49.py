#!/usr/bin/env python3
"""Create GitHub issue #49 for Signal Relay Array win condition"""

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

issue_body = """## Feature: Signal Relay Array (Win Condition)

**Implementation Notes:**
- This is a **3D first-person implementation only** - No 2D top-down code
- NO combat mechanics
- Pure survival and rescue gameplay

### Resource Requirements
- 40 Metals
- 20 H2

### Components

#### 1. Signal Relay Array Structure
- **3D Holographic Antenna** with rotating elements
- Semi-transparent glow effect (cyan/white)
- Rotating dish or panels that spin around the central mast
- Interactive placement in build mode (4x4 tile)

#### 2. Power System
- Requires H2 fuel to operate
- Visual power indicator when powered on
- Cannot broadcast without power (shows red when H2 depleted)

#### 3. Tech Tree Integration
- Research unlock via existing tech tree UI
- Requires "Fusion Reactor" technology (M4: Deep Systems)
- Appears in Advanced technology category
- Cost: 20 Research Points + 10 Tech Chips

#### 4. Broadcast Button
- Press 'B' key to activate distress signal
- Only available when:
  - Signal Relay Array is built AND powered
  - Tech researched (Fusion Reactor)
- Holographic UI overlay prompts usage

#### 5. Distress Signal Visuals
- Cyan flashing beacon atop the relay
- Expanding pulse waves from the structure
- Radar sweep visual indicating broadcast radius
- Audio drone: low-frequency pulsing sound when powered

#### 6. Rescue Ship
- **3D Spacecraft** spawns and approaches the station
- Simple floating geometry (fuselage + wings + engine glow)
- Glides smoothly toward the relay structure
- Arrives and hovers for pickup
- Returns to the player

#### 7. Ending Sequence
- Cinematic camera fly-around of the rescue scene
- "MISSION COMPLETE" UI overlay with stars background
- Narrative dialogue: "Rescue confirmed. Extraction imminent."
- Fade to black → Return to main menu

#### 8. Audio System
- **Low-frequency drone**: continuous humming when relay is powered
- **Pulsed distress signal**: rhythmic beeping when broadcasting (8Hz pattern)
- **Rescue arrival**: ascending tones as ship approaches
- **Win completion**: triumphant chord sequence

### Acceptance Criteria (per ROADMAP)

1. ✅ Signal Relay Array structure built in 3D space with holographic appearance
2. ✅ Power consumption system with H2 fuel requirement
3. ✅ Tech tree research unlocks the relay component
4. ✅ Broadcast button ('B' key) triggers distress signal
5. ✅ Visual distress signal (beacon, pulse waves, radar sweep)
6. ✅ Rescue ship spawns and flies to the station
7. ✅ Victory cinematic with narration
8. ✅ Audio feedback for powered state and broadcast

### Known Implementation Constraints
- All rendering via Three.js WebGL (no 2D canvas overlays)
- First-person camera only for gameplay
- No combat or enemy interactions
- Pure survival/emergency simulation

### Implementation Priority
1. Basic signal relay structure with rotating elements
2. Power system (H2 consumption state)
3. Tech tree integration
4. Broadcast button and visual distress signal
5. Rescue ship spawning and movement
6. Victory cinematic and ending sequence
7. Audio system integration

**Milestone:** M4: Deep Systems
**Category:** Advanced / Communication
**Implementation Type:** 3D First-Person Survival Game
"""

# Step: Create issue #49
print("Creating issue #49 (Signal Relay Array win condition)...")

payload = {
    "title": "Signal Relay Array (win condition)",
    "body": issue_body,
    "milestone": "M4: Deep Systems",
    "labels": ["enhancement"]
}

cmd = [
    "curl", "-s", "-X", "POST",
    f"{api_url}/issues",
    "-H", json.dumps({"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}),
    "-d", json.dumps(payload)
]

result = subprocess.run(cmd, capture_output=True, text=True)

try:
    issue_data = json.loads(result.stdout)
    print(f"✓ Issue #{issue_data['number']} created successfully")
    print(f"URL: {issue_data['html_url']}")
    sys.exit(0)
except Exception as e:
    print(f"❌ Error creating issue:")
    print(f"STDOUT: {result.stdout[:500]}")
    print(f"STDERR: {result.stderr[:500]}")
    sys.exit(1)