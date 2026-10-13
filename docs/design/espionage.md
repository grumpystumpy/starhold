# Design — Espionage (P0)

## Goal

Whisper Probe mission → text intel report. Depth scales with Shadow Optics vs target Research Lab.

## Requirements

- Ship: **Whisper Probe** (yard L1, cheap crystal).
- Mission: `espionage` → target another commander’s planet.
- Probes travel, write `spyReports`, return (v1: probes survive).

## Detail formula

`espionageDetail(spyTech, targetLab)` (invented): higher spy tech and lower target lab → more layers:

| Detail | Reveals |
|--------|---------|
| 0 | Jammed summary only |
| 1 | Resources |
| 2 | + ships + defenses |
| 3 | + buildings + research |

## Ties

- Research tree: Shadow Optics.
- Reports UI: spy report list (separate from combat reports).
- Galaxy/roster: pick target planet.

## Intel decay

Reports older than `SPY_REPORT_TTL_MS` (20 min wall clock) are pruned on advance/view. See [empire-logistics.md](./empire-logistics.md).

## Completeness

**Have:** probe, mission, report layers, UI, unit test, intel decay.  
**Optional later:** probe destruction chance.
