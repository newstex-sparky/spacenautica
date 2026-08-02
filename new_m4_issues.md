# New M4 Issues for Spacenautica

## Issue #92: Tech Tree 3D Holographic UI
**Milestone:** M4: Deep Systems  
**Priority:** High  
**Description:**
Interactive holographic interface for researching and unlocking tech upgrades. This should be a 3D UI that appears in the game, not a 2D overlay.

**Requirements:**
- 3D holographic visualization using Three.js
- Tech tree structure (nodes and connections)
- Click to select and research tech
- Visual feedback when tech is unlocked
- Clear indication of which tech is available and which is locked
- No 2D UI elements (pure 3D hologram)

**Technical Notes:**
- Use Three.js primitives for holographic appearance (wireframes, glowing materials)
- Place in first-person view, possibly triggered by accessing a terminal or research station
- Compatible with first-person camera (no top-down mode for this UI)
- No combat or enemies - this is a survival/base-building game

**Acceptance Criteria:**
- Tech tree renders in 3D space as a hologram
- Nodes can be clicked to trigger research
- Visual feedback shows active research and unlocked tech
- No 2D HTML/CSS UI elements for this feature

---

## Issue #93: Shuttle Pod Vehicle
**Milestone:** M4: Deep Systems  
**Priority:** Medium  
**Description:**
Player can launch from their station in a small shuttle pod, fly in the asteroid field, and return to dock.

**Requirements:**
- 3D shuttle pod model (simple geometric design)
- Launch animation from station
- Flight controls (3D, first-person or cockpit view)
- Navigate asteroid field with asteroids
- Docking mechanism at station
- Return to station safely

**Technical Notes:**
- Keep in 3D first-person perspective
- No combat - just navigation
- Use existing asteroid models for environment
- Shuttle should be a separate session or seamless transition from station

**Acceptance Criteria:**
- Shuttle model renders in 3D
- Player can launch and fly the shuttle
- Shuttle can navigate asteroids
- Shuttle can dock at player's station

---

## Issue #94: Signal Relay Array Win Condition Verification
**Milestone:** M4: Deep Systems  
**Priority:** High  
**Description:**
Verify and finalize the Signal Relay Array as the win condition structure.

**Requirements:**
- 4x4 station module that triggers broadcast sequence when powered and activated
- Proper placement in station grid
- Power connection system (needs H2 fuel)
- Activation mechanism (console or panel)
- Broadcast sequence triggers correctly when win condition is met
- Clear visual indication that broadcasting is active

**Technical Notes:**
- Use existing station module placement logic
- Integrate with existing H2 power system
- Connection with distress broadcast sequence
- Visual feedback for powered vs. unpowered relay
- Clear win condition display

**Acceptance Criteria:**
- Relay module can be placed and powered
- Relay can be activated
- Broadcasting triggers when powered and active
- Clear visual feedback

---

## Issue #95: Distress Broadcast Sequence
**Milestone:** M4: Deep Systems  
**Priority:** Medium  
**Description:**
30-second distress transmission that triggers rescue ship arrival.

**Requirements:**
- Distinct visual and audio sequence for broadcasting
- Rescue ship arrival animation
- Ending sequence presentation
- Option to continue sandbox mode after rescue

**Technical Notes:**
- 3D sequence (no cutscenes with 2D video)
- Use existing Three.js scene and camera
- Audio for distress signal and ship arrival
- Seamless integration with existing game loop
- Option to continue playing after rescue

**Acceptance Criteria:**
- Distress sequence plays when relay is activated
- Rescue ship arrives with animation
- Player can continue in sandbox mode after rescue
- All in 3D space, no 2D cutscenes

---

**Note:** These issues follow the rule of never adding combat, staying in 3D first-person perspective, and maintaining the passive survival/base-building tone of Spacenautica.

**Order of Implementation:**
1. Issue #94: Verify Signal Relay Array (win condition structure)
2. Issue #95: Distress broadcast sequence (ending sequence)
3. Issue #92: Tech tree 3D holographic UI (endgame progression)
4. Issue #93: Shuttle pod vehicle (optional story element)