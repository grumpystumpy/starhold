# Design — Planet fields soft-cap

## Goal

Genre-style building budget: planets cannot grow buildings forever without a field limit.

## Rules

- Cap: **`PLANET_FIELDS = 200`** (prototype constant).
- Cost: each building **level** consumes 1 field (`sum` of building levels).
- Defenses / ships do **not** consume fields.
- When `fieldsRemaining < 1`, building upgrades fail with a clear error.

## UI

Show `Fields used / cap` (and remaining) on the Buildings panel.

## Ties

- Soft pressure before terraformer (out of scope).
- Works with Research Lab + vault spam limits.

## Status

Sim + reject + Buildings UI fields line **have** (empire-logistics batch).
