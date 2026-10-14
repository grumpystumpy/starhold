import type {
  Coordinates,
  FleetShips,
  MissionType,
  Resources,
} from "@starhold/game";
import { SHIP_ORDER } from "@starhold/game";
import { root } from "./session";

export function readFleetForm(): {
  mission: MissionType;
  ships: Partial<FleetShips>;
  targetPlanetId?: string;
  targetCoords?: Coordinates;
  asteroidId?: string;
  pirateBaseId?: string;
  alienBaseId?: string;
  cargo?: Partial<Resources>;
} | null {
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return null;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  const missionEl = form.querySelector<HTMLInputElement>(
    'input[name="fleet-mission"]:checked',
  );
  if (!target?.value) return null;
  const ships: Partial<FleetShips> = {};
  for (const id of SHIP_ORDER) {
    const input = form.querySelector<HTMLInputElement>(
      `[data-fleet-count="${id}"]`,
    );
    ships[id] = Math.max(0, Math.floor(Number(input?.value) || 0));
  }
  const mission = (missionEl?.value ?? "deploy") as MissionType;
  const cargo: Partial<Resources> = {
    metal: Math.max(
      0,
      Math.floor(
        Number(
          form.querySelector<HTMLInputElement>("[data-cargo-metal]")?.value,
        ) || 0,
      ),
    ),
    crystal: Math.max(
      0,
      Math.floor(
        Number(
          form.querySelector<HTMLInputElement>("[data-cargo-crystal]")?.value,
        ) || 0,
      ),
    ),
    deuterium: Math.max(
      0,
      Math.floor(
        Number(
          form.querySelector<HTMLInputElement>("[data-cargo-deuterium]")?.value,
        ) || 0,
      ),
    ),
  };
  if (target.value.startsWith("planet:")) {
    return {
      mission,
      ships,
      targetPlanetId: target.value.slice("planet:".length),
      cargo: mission === "transport" ? cargo : undefined,
    };
  }
  if (target.value.startsWith("asteroid:")) {
    return {
      mission,
      ships,
      asteroidId: target.value.slice("asteroid:".length),
    };
  }
  if (target.value.startsWith("alien:")) {
    return {
      mission: "alienRaid",
      ships,
      alienBaseId: target.value.slice("alien:".length),
    };
  }
  if (target.value.startsWith("pirate:")) {
    return {
      mission,
      ships,
      pirateBaseId: target.value.slice("pirate:".length),
    };
  }
  if (target.value.startsWith("coords:")) {
    const [g, s, slot] = target.value
      .slice("coords:".length)
      .split(":")
      .map(Number);
    if (!g || !s || !slot) return null;
    return {
      mission,
      ships,
      targetCoords: { galaxy: g, system: s, slot },
    };
  }
  return null;
}
