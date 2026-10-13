# Design — Planet fields soft-cap

## Goal

Genre-style building budget: planets cannot grow buildings forever without a field limit.

## Rules (universe contract v1)

- Cap is **per planet**, rolled at creation (`PlanetState.fieldsCap`).
- Slot curve: smallest at slots **1** and **15** (min **250**); peak at slot **8**.
- Each slot rolls uniformly in `[center − FIELD_BAND, center + FIELD_BAND]` (`FIELD_BAND = 15`), then clamp to `FIELD_MIN`.
- Cost: each building **level** consumes 1 field (`sum` of building levels).
- Defenses / ships do **not** consume fields.
- When `fieldsRemaining < 1`, building upgrades fail with a clear error.
- Moons: `MOON_FIELDS_BASE + MOON_FIELDS_PER_LUNAR_BASE * lunarBase` (unchanged).

See [universe-contract.md](./universe-contract.md) §3 for the full center table.

## UI

Show `Fields used / cap` (and remaining) on the Buildings panel. Position mults echo on `economy.positionMult`.

## Status

Sim + reject + Buildings UI fields line **have**; Thread A lands rolled caps + curve.
