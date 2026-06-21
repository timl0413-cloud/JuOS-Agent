---
packet_id: "2026-06-19_003_gsync-v0-registry-baseline"
title: "GSync v0 Registry Baseline"
packet_type: "baseline"
domain: "gsync"
status: "accepted"
freshness: "current"
source: "GSync"
target: "GSync"
owner: "GSync"
baseline_ref: "XiaoJu Ecosystem Program Development Baseline V6.0"
overlay_ref: "JUB / GSync Calibration Before 7/7"
created_at: "2026-06-19"
updated_at: "2026-06-19"
next_action: ""
blocker_flag: false
file_path: "/gsync/packets/accepted/2026-06-19_003_gsync-v0-registry-baseline.md"
---

# Summary

Defines GSync v0 accepted packet format, registry files, freshness tracking, and explicit out-of-scope items.

# Accepted Context

- File-based registry under `gsync/` with packet index, freshness, and routes metadata
- Accepted packets in `packets/accepted/`; lifecycle folders: draft, superseded, archived
- Template: `templates/packet-template.md`
- Cross-room handoff uses packet IDs and paths, not transcripts

# Boundary / Constraints

**In scope:** accepted registry, index, freshness states, route metadata, manual Tim-approved routing.

**Out of scope:** DB backend, raw chat scraping, auto ingestion, JuCore, worker integration, TimOS/OB DB writes, full UI, knowledge graph.

# Next Action

None — v0 baseline accepted; extend only with Tim approval.

# Freshness Check

- Status: accepted; freshness: current
- Baseline and overlay refs present
