# Spacenautica — GitHub Issues

> **Milestone tracking** — Follow M1→M4 priority order from ROADMAP.md
>
> - M1 ✅ Core Survival Loop — Complete
> - M2 ✅ Station Building — Complete
> - M3 ✅ Art Pipeline — Complete
> - M4 ✅ Deep Systems — Complete

---

## M1 — Core Survival Loop ✅

All M1 issues complete (#28, #30, #31, #32, #33).

---

## M2 — Station Building ✅

All M2 issues complete (#36, #37, #38, #39).

---

## M3 — Art Pipeline ✅

All M3 issues complete (#41, #42, #43, #44, #45).

---

## M4 — Deep Systems ✅

### #47 — Tech tree 3D holographic UI
**Status:** ✅ Complete
**Priority:** Medium (endgame progression)

### #48 — Shuttle pod vehicle
**Status:** ✅ Complete
**Priority:** Medium (endgame progression, optional story element)

### Signal Relay Array (Win Condition)
**Status:** ✅ Complete
**Priority:** High (endgame)

### Distress broadcast sequence
**Status:** ✅ Complete
**Priority:** Medium (ending sequence)

**Description:** 30-second broadcast transmission that triggers rescue ship arrival and displays victory ending cinematic. Now fully implemented with: H2-powered signal beam, animated antenna rotation, rescue ship approach/dock animation, victory cinematic camera flyaround, and final victory screen with "MISSION COMPLETE" message and restart button.

---

## Future (Deferred)

### #46 — Multi-sector warp travel
**Status:** ⏸️ Deferred
**Priority:** Low (future expansion)
**Description:** Warp between multiple asteroid sectors.
**Blocking:** None (design for expansion)

### Solar flare / debris storm hazards
**Status:** ⏸️ Deferred
**Priority:** Low (future sectors only)
**Description:** Environmental hazards in specific sectors.

### Hull breach mini-game
**Status:** ⏸️ Deferred
**Priority:** Low (optional gameplay mechanic)
**Description:** Emergency repair sequence when station hull is damaged.

---

## How to Work on Issues

1. Open this file and find the lowest-numbered issue that's NOT deferred and NOT combat-related.
2. Read the ROADMAP.md for full context.
3. Implement the feature in the repo at `/home/newstex/workspace/spacenautica`.
4. Build with `npm run build` — fix any errors.
5. Test locally with `python3 -m http.server 8000` and open `http://localhost:8000/index.html`.
6. Commit and push with message: `feat: <description> (closes #<issue>)`
7. Update the issue status below.

---

## Latest Activity

- **Last updated:** 2026-08-01
- **Cron worker:** Spacenautica autonomous development agent
- **Current task:** All M1-M4 issues complete — game feature-complete