# GSync v0 — File-based Packet Registry

## Purpose

GSync v0 is a file-based packet registry for Taiwan readiness (7/4–7/5 system lock). It enables cross-room handoff using **accepted packets** instead of Tim manually carrying full chat history between rooms.

## Scope

- Accepted packet registry (`packets/accepted/`)
- Packet index (`registry/packet-index.yaml`)
- Freshness check metadata (`registry/freshness.yaml`)
- Route / source / target metadata (`registry/routes.yaml`)
- Visibility for accepted, current, stale, superseded, and awaiting-response states

## Non-goals

GSync v0 does **not** include:

- Database-backed architecture
- Automation or auto-routing without Tim approval
- Raw chat scraping or transcript ingestion
- Automatic conversation ingestion or room memory sync
- JuCore activation
- Worker integration
- Direct TimOS or Operation Board database write paths
- Full GSync UI, knowledge graph, or autonomous memory ingestion

## Operating rule

- **Accepted packets only** — no raw transcripts, no full room-history dumping
- Packets move through `draft/` → `accepted/` (or `superseded/` / `archived/`) manually with Tim approval
- Cross-room handoff references packet IDs and file paths, not chat logs

## Freshness rule

A packet is considered fresh when:

1. It is the latest **accepted** packet for its topic (status not `superseded`)
2. Freshness state is `current` (not `stale`, `blocked`, or `superseded` unless explicitly marked)
3. `baseline_ref` and `overlay_ref` are present and match the active parent baseline and overlay

Check `registry/freshness.yaml` for per-packet freshness metadata.

## Parent references

- **Parent baseline:** XiaoJu Ecosystem Program Development Baseline V6.0
- **Operational overlay:** JUB / GSync Calibration Before 7/7

## Folder layout

```
gsync/
  README.md
  templates/packet-template.md
  registry/
    packet-index.yaml
    freshness.yaml
    routes.yaml
  packets/
    draft/
    accepted/
    superseded/
    archived/
```
