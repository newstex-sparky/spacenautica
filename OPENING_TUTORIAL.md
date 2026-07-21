# Spacenautica — Opening Tutorial Mission Design

> Epic tutorial sequence that introduces players to controls, stakes, and the core survival loop through a cinematic opening in a derelict colony ship.

---

## Overview

**Mission Type**: Cinematic Tutorial / Prologue
**Duration**: 3-5 minutes
**Location**: *Meridian* colony ship (derelict wreckage)
**Objective**: Escape from ship in escape pod before destruction

---

## Scene Structure

### **Scene 0: Cryosleep Awakening**

**Visual Setup:**
- Player character in cryosleep pod (frozen state)
- Dim blue/purple ambient lighting
- Faint hum of cryosleep machinery
- Screen fades from black to pod interior

**Initial Dialog (Doctor NPC):**
```
DOCTOR: "Welcome back. Can you move your fingers for me?"

PLAYER: [Player can press space/click to test movement]

DOCTOR: "Good. Open your eyes. You've been in stasis for 40 days. Your body will be stiff—take it slow."

DOCTOR: "We're aboard the Meridian colony ship. We jumped 37 lightyears from home, but something went wrong. Gravity anomaly pulled us into an uncharted system. The ship... it's damaged."

DOCTOR: "I need you to run to Escape Pod 04. It's on Deck 4, Sector B. Move now."

DOCTOR: "Get to the escape pod, NOW!"
```

**Objective Display:**
```
OBJECTIVE: REACH ESCAPE POD 04
CURRENT LOCATION: Cryo Deck, Deck 4
```

---

### **Scene 1: The Alarm**

**Visual Triggers:**

1. **Screen Shake (0-3 seconds)**
   - Slight shake intensifies over 2 seconds
   - Sound: mechanical creaking, hull groaning
   - Player controls still functional during shake (can move)

2. **Lighting Shift (3-5 seconds)**
   - All normal lighting fades to dim red emergency lighting
   - Ambient color shifts from blue → dark red (~0.2 brightness)
   - Red emergency strobe lights flicker

3. **Audio Shift (3-5 seconds)**
   - Faint hum fades
   - Klaxon alarms begin: repeating low-frequency wail
   - Crew panic audio in background: shouting, running, equipment clatter

**Player Reaction:**
```
DOCTOR (voiceover): "Hull breaches in Sector B! Gravity pressure increasing! Get to the escape pod, NOW!"
```

**Objective Update:**
```
OBJECTIVE: ESCAPE THE SHIP (TIME SENSITIVE)
SURVIVABILITY: 30 MINUTES
```

---

### **Scene 2: Sprinting Tutorial**

**Control Tutorial Integration**

Before the alarm, players should have had a brief tutorial:

```
DOCTOR: "Standard movement uses WASD or left joystick. Crouch with C or R3. Sprint is Shift or R2. You'll need to move fast."
```

**During Chaos:**

**Obstacle 1: Bulkhead Door (0:00)**
- Locked door blocks path
- Player must sprint + crouch under it
- Prompt: `Sprint + Crouch (Shift + C) to slide under`

**Obstacle 2: Hanging Beams (0:15)**
- Horizontal beams blocking corridor
- Option A: Jump over (requires player to practice vertical movement)
- Option B: Crawl under (recommended path)
- Prompt: `Jump (Space/X) or Crouch (C/R3) to avoid beams`

**Obstacle 3: Debris Field (0:30)**
- Floating debris crates, cables
- Obstacles can be vaulted or dodged
- Prompt: `Jump (Space/X) or Slide (Shift + C) to navigate`

**Obstacle 4: Emergency Ladder (0:45)**
- Vertical descent to escape pod level
- Player character climbs down
- Visual: other crew members running, some falling, others calling for help

**Gameplay Notes:**
- Sprint stamina system introduced (starts at 100%, regenerates when not sprinting)
- Sprint indicator shows on HUD (stamina bar)
- Obstacles scaled to player speed (not too difficult, but noticeable)
- Player feels urgency without being impossible

---

### **Scene 3: Escape Pod Chamber**

**Visual Setup:**
- Dark, cramped corridor with emergency red lighting
- Fire/smoke effects (flickering orange/red particles)
- Steam venting from ceiling
- Muffled alarms, distant explosions

**Objective:**
```
OBJECTIVE: ENTER ESCAPE POD 04
DISTANCE: 50 METERS
TIME REMAINING: 24 MINUTES
```

**Narrative Moment (Player alone):**

As player reaches pod bay:

```
VOICEOVER (Do not speak, only audio of escaping crew):"
- "I'm stuck! Help!"
- "The door won't open!"
- "It's gone!"
- "I can't move! It's crushing me!"
```

**Player's Action:**
- Find escape pod 04 (marked with glow, clearly visible)
- Interact with pod door [E]
- Pod auto-locks, seals, ejects from ship
- Player controls cut — cinematic sequence begins

---

### **Scene 4: Ejection Cinematic**

**Visual Sequence (30 seconds, no player control):**

1. **Pod Door Slams Shut (0-5 seconds)**
   - Red emergency light outside pod windows
   - Interior lights flicker, stabilize to blue
   - Sealing sounds (hydraulic hiss)

2. **Pod Launch (5-15 seconds)**
   - Grappling hooks fire, retract
   - Pod shakes violently as ejection thrusters engage
   - View from pod interior: ship receding in distance
   - Massive explosion behind pod (secondary ship section breaks off)

3. **Debris Field (15-25 seconds)**
   - Debris tumbling past pod windows
   - Hull fragments, cables, shattered glass
   - Ship begins to split: large piece detaches

4. **Final Explosion (25-30 seconds)**
   - Ship fully splits in half
   - Massive fireball consumes remaining structure
   - Pod drifts away into space
   - Fades to black

**Audio:**
- Engine roar, ejection blast
- Debris impacts on pod exterior (thuds, metallic clangs)
- Fading klaxon alarms
- Explosion rumble
- Wind/ventilation fade

---

### **Scene 5: Title Sequence (Opening Title Card)**

**Visual Setup:**
- Black void background with stars
- Escape pod drifting (player in seat, can look around)
- HUD systems boot up:
  - O2: 29:45
  - Hull: 100%
  - Power: 15%
  - Location: Unknown Sector
  - Signal: None detected

**Opening Title Card (4-5 seconds)**
```
FADE IN: White text appearing with each beat

SPACENAUTICA

[AUDIO: Deep, resonant orchestral swell]

A SUBNAUTICA-STYLE
SURVIVAL GAME IN SPACE

[AUDIO: Harsh explosion sound fades]
```

**Final State:**
- Title card fades out
- Player gains control
- Objectives screen appears:
  ```
  MISSION START

  You are the sole survivor of the colony ship *Meridian*.
  Your escape pod drifted 200 lightyears from home.

  GOALS:
  1. Establish a breathable habitat
  2. Survive the vacuum (O2 management)
  3. Scavenge resources from wreckage
  4. Find a way home

  TUTORIAL:
  - WASD / Left Stick: Move
  - Shift / R2: Sprint
  - Space / X: Jump
  - C / R3: Crouch
  - E: Interact
  - ESC: Pause
  ```
- First objective set:
  ```
  PRIMARY:
  - Explore nearby debris field
  - Find salvageable resources

  SECONDARY:
  - Repair escape pod (if possible)
  - Scan for signals
  ```

---

## Design Principles

### **Control Introduction**

**Gradual, Contextual, Non-Interruptive**

1. **Pre-Alarm Tutorial (Scene 0)**
   - Doctor introduces controls with simple phrases
   - "Move with WASD or left joystick"
   - "Sprint with Shift for emergencies"
   - "Jump over obstacles, crouch under beams"

2. **In-Action Learning (Scene 1-2)**
   - Obstacles teach movement skills
   - Hints appear only when stuck
   - No tutorial popups during critical moments

3. **Post-Cinematic Summary**
   - Objectives screen lists controls
   - Quick reference in inventory menu

---

### **Tone & Atmosphere**

**Isolation + Urgency + Cosmic Horror**

1. **The Mother Ship as Enemy**
   - Ship is both home and threat
   - Internal chaos mirrors external void
   - Debris, smoke, emergency lighting = claustrophobia in open space

2. **Human Scale vs. Cosmic Scale**
   - Escape pod is tiny compared to *Meridian* explosion
   - Player feels insignificance before controlling
   - Background noise (crew panic, distant explosions) provides scale

3. **Color Psychology**
   - Cryosleep: Calm blue, peaceful
   - Chaos: Flickering red emergency lights, orange smoke
   - Vacuum: Black void, stars, cold isolation
   - Hope: Bright blue pod interior, calm after explosion

---

### **Survival Hook (Act 1 Foundation)**

**Establishes Core Systems Immediately**

1. **Oxygen Awareness**
   - Tutorial ends with pod launch, O2 countdown visible
   - Players see their survival resource from start

2. **Goal Clarity**
   - Survive → Build → Explore → Find Home
   - Simple progression structure

3. **Environmental Hazards**
   - Hull damage mentioned by Doctor
   - Gravity anomaly causes ship breakage
   - Debris field introduces space hazards

---

## Technical Implementation Notes

### **Game State Transition**

```
START → Cryosleep Awakening → Alarm/Chaos → Sprint Tutorial → Escape Pod → Cinematic → Title → Game Start
```

### **Scene Manager**

- Separate scene transitions for cinematics vs. gameplay
- Cinematics: No player input, scripted animations
- Gameplay: Full controls, camera follows player
- Smooth fade transitions (3-5 seconds) between scenes

### **Audio Cues**

- Alarm sequence: Starts at 60% volume, increases to 100% then fades
- Player heartbeat during sprint: Subtle audio cue
- Pod launch: Doppler effect on distant explosions
- Title music: Orchestral swell builds to climax

### **HUD Elements**

**In Ship:**
- Mini-map with pod location (green marker)
- Objective tracking (progress bar: corridor → beams → pod)
- Status indicators: Hull damage (if visible), O2 (slow drain during chase)

**In Escape Pod:**
- Main HUD visible: O2 bar, hull integrity, power, location
- Navigation: Star map direction to nearest asteroid/wreckage
- First objective: "Explore Debris Field"

---

## Variations & Extensions

### **Difficulty Scaling**

- **Normal**: Full tutorial, optional obstacles
- **Hard**: Less time between alarm and pod, more debris, faster obstacles
- **Easy**: Obstacles scaled down, more time to react

### **Cinematic Enhancement**

- Camera shakes during explosion
- Pod camera FOV increases (feeling of speed)
- Debris passes quickly on fast-motion camera

### **Alternate Endings (Post-Game)**

- **Bad Ending**: Player dies in pod (O2 depleted, ship debris collision)
- **True Ending**: Player survives, salvage ship systems, and find ancient tech
- **Good Ending**: Player escapes with more resources and information

---

## Story Integration

### **Connection to Act 1**

1. **Derelict Meridian Wreckage**
   - Tutorial establishes *Meridian* destruction
   - Players will explore same wreckage in Act 1

2. **First Base Location**
   - Escape pod drifts to nearby debris field
   - Player's first mission: scavenge resources from tutorial wreckage

3. **Ancient Signal Discovery**
   - After first base established, player scans wreckage
   - Finds strange energy signature from *Meridian* crash site
   - Quest: Investigate mysterious alien technology

### **Character Background**

- Briefly mentioned: Player was on *Meridian* for research or colonization
- Doctor is first NPC encountered (though can't save during opening)
- Reason for survival: Was in stasis, not on flight deck during crisis

---

## Acceptance Criteria

### **Functional Requirements**

- [ ] Cryosleep awakening sequence with Doctor dialog
- [ ] Screen shake and lighting shift when alarm triggers
- [ ] Sprint tutorial with 4 obstacle types
- [ ] Escape pod ejection cinematic
- [ ] Massive ship destruction (split + explosion)
- [ ] Opening title card with audio
- [ ] HUD shows O2, hull, power, location
- [ ] Player gains full control after title
- [ ] Tutorial objectives set correctly

### **Visual Requirements**

- [ ] Cryosleep pod interior with realistic cryosleep effects
- [ ] Ship hallways with debris, smoke, emergency red lighting
- [ ] Escape pod with holographic HUD interface
- [ ] Massive explosion from multiple camera angles
- [ ] Title sequence with cinematic letterboxing

### **Audio Requirements**

- [ ] Doctor voice lines with proper timing
- [ ] Klaxon alarm with escalating intensity
- [ ] Player breathing/audio during sprint
- [ ] Pod launch sound effects (thrusters, ejection)
- [ ] Distant crew panic, explosions, debris impacts
- [ ] Title music with orchestral swell

### **Controls Requirements**

- [ ] WASD/mouse or gamepad navigation works during tutorial
- [ ] Sprint mechanic functional and stamina-regenerating
- [ ] Crouch/jump mechanics work with obstacles
- [ ] Interact key opens escape pod door
- [ ] ESC pauses game (cinematics may not be pausable)
- [ ] HUD shows control hints

---

## Post-Tutorial Game Loop

**Immediate Next Steps**

1. **Explore Debris Field (Objective 1)**
   - EVA out of escape pod
   - Dock with nearby asteroid
   - Scan for resources

2. **First Base Construction**
   - Return with resources
   - Build simple habitat module
   - Set up O2 generator
   - Save first progress

3. **First Exploration**
   - Jetpack to larger wreck
   - Find blueprints
   - Progress to Act 1 objectives

---

## Summary

This opening tutorial combines:
- **Narrative hooks**: Ship destruction, sole survivor, mystery
- **Control tutorial**: Contextual, non-educational, immersive
- **Survival mechanics**: O2 awareness, goal clarity, hazard introduction
- **Atmospheric tone**: Isolation, urgency, cosmic scale

Players leave the tutorial feeling:
- **Competent** (control mechanics practiced)
- **Urgent** (30-minute O2 timer, escape pod launch)
- **Curious** (why was Meridian destroyed? what's out there?)
- **Survival-focused** (O2 bar always visible, hazards introduced)

The tutorial then seamlessly leads into Act 1's core loop: explore wreckage, scavenge resources, build base, and uncover the mystery of the *Meridian*'s destruction.