# Design — Empire logistics polish (P0 harden)

## Goal

Make multi-planet play feel real: reposition fleets to own worlds, age out spy intel, and surface the already-enforced planet field budget.

## Deploy → own colonies

| Target | Behavior |
|--------|----------|
| **Rival** | Unchanged: peaceful visit, return leg, ships come home. |
| **Own other planet** | **Park:** ships dock at destination (no return). No cargo required (use **transport** to move resources). |
| **Same planet** | Reject. |

UI: Deploy mission target list = own other planets **plus** rivals (labeled).

## Transport (unchanged rules + UX)

- Still requires cargo load + own other planet.
- Empty state: explain colonize path (Astrophysics → Colony Ship → empty galaxy slot).

## Espionage intel decay

- Spy reports expire after **`SPY_REPORT_TTL_MS`** (default **20 minutes** wall clock).
- Expired reports are dropped on universe advance / player view (no revive).
- Encourages re-probing; detail formula unchanged ([espionage.md](./espionage.md)).

## Planet fields (sim already enforced)

- Budget: per-planet `fieldsCap` (slot curve, min 250) — each building level costs 1 field ([formulas-build](../../packages/game/src/formulas-build.ts)). See [planet-fields.md](./planet-fields.md).
- Upgrade rejects with “No free planet fields remaining.”
- **This batch:** show used / remaining on the Buildings panel so the soft-cap is visible.

## Combat / system ties

- Deploy-park does not fight.
- Field cap gates Research Lab + defenses + mines equally.
- Intel decay is presentation/lifecycle only (not combat).

## Tests

- Unit: deploy to own docks; deploy to rival still returns; spy report vanishes after TTL; fieldsRemaining blocks upgrade at cap.
- CI e2e smoke unchanged (Upgrade / Shipyard / fleets).
