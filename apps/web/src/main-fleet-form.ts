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
  openAcs?: boolean;
  acsGroupId?: string;
} | null {
  return readFleetFormIn(root);
}

/** Same mapping as the one-page form. Speed is not read and not returned. */
export function readFleetFormIn(scope: ParentNode): ReturnType<typeof readFleetForm> {
  const form = scope.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return null;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  const missionEl = form.querySelector<HTMLInputElement | HTMLSelectElement>(
    '[name="fleet-mission"]',
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
  const acsJoin =
    form.querySelector<HTMLSelectElement>("#fleet-acs-join")?.value || "";
  const openAcs =
    Boolean(
      form.querySelector<HTMLInputElement>("#fleet-open-acs")?.checked,
    ) && !acsJoin;
  const acsOpts = {
    openAcs: openAcs || undefined,
    acsGroupId: acsJoin || undefined,
  };
  if (target.value.startsWith("planet:")) {
    return {
      mission,
      ships,
      targetPlanetId: target.value.slice("planet:".length),
      cargo: mission === "transport" ? cargo : undefined,
      ...acsOpts,
    };
  }
  if (target.value.startsWith("asteroid:")) {
    return {
      mission,
      ships,
      asteroidId: target.value.slice("asteroid:".length),
      ...acsOpts,
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
      ...acsOpts,
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
      ...acsOpts,
    };
  }
  return null;
}
