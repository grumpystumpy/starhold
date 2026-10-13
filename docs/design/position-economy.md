# Design — Position production (Thread A)

## Intent

Slot position relative to the star changes mine/energy yields:

- Closer to sun (low slot) → more **crystal**, more **energy**
- Further from sun (high slot) → more **deuterium**, less **energy**
- Slot **8** is neutral **1.0×** on metal / crystal / deuterium / energy
- Metal stays flat at **1.0×** in v1

## Application order

Mine level → energy factor → `PRODUCTION_MULT` / universe speed / energy tech → **position mult**

Energy mult scales **solar production** used in the energy factor (moons use parent slot via shared coords).

## API

- `productionMultForSlot(slot)` in `@starhold/game`
- `EconomySnapshot.positionMult` for UI tooltips

Full table: [universe-contract.md](./universe-contract.md) §4.
