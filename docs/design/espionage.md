# Design — Espionage (P0)

## Goal

Spy Probe mission → text intel report. Depth scales with Espionage Tech vs target Research Lab.

## Requirements

- Ship: **Spy Probe** (yard L1, cheap crystal).
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

- Research tree: Espionage Tech.
- Reports UI: spy report list (separate from combat reports).
- Galaxy/roster: pick target planet.

## Completeness

**Have:** probe, mission, report layers, UI, unit test.  
**Optional later:** intel decay (gap-analysis idea); probe destruction chance.
