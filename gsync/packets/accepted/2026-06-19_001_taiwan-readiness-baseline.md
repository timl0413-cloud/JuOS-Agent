---
packet_id: "2026-06-19_001_taiwan-readiness-baseline"
title: "7/7 Taiwan Readiness Baseline"
packet_type: "baseline"
domain: "travel-readiness"
status: "accepted"
freshness: "current"
source: "JUB"
target: "GSync"
owner: "GSync"
baseline_ref: "XiaoJu Ecosystem Program Development Baseline V6.0"
overlay_ref: "JUB / GSync Calibration Before 7/7"
created_at: "2026-06-19"
updated_at: "2026-06-19"
next_action: "Maintain accepted packet set through 7/4 system lock"
blocker_flag: false
file_path: "/gsync/packets/accepted/2026-06-19_001_taiwan-readiness-baseline.md"
---

# Summary

Defines what must be stable before Tim's 7/7 Taiwan departure and what is intentionally deferred past the travel window.

# Accepted Context

- Ideal system lock: 2026-07-04; latest safe target: 2026-07-05
- No major engineering planned for 2026-07-06
- STUF first version (2026-06-23) takes priority this week
- GSync v0 file registry supports cross-room handoff without full chat history

# Boundary / Constraints

**Must be stable before Taiwan:**

- Accepted GSync packet set for handoff context
- STUF staging path operational for client review
- JOA worker hub reboot-safe with visible status

**Intentionally deferred:**

- JuCore activation
- Database-backed GSync
- SpaceA Bridge as active STUF path
- Full GSync UI or autonomous ingestion

# Next Action

Maintain and refresh accepted packets through 7/4 system lock; supersede when decisions change.

# Freshness Check

- Status: accepted; freshness: current
- Baseline and overlay refs present
- Review before 7/4 if travel-readiness assumptions change
