import {
  SHIP_ORDER,
  type AcsPrefill,
  type Coordinates,
  type FleetShips,
  type MissionType,
  type Resources,
} from "@starhold/game";

export const MISSIONS: MissionType[] = [
  "deploy",
  "raid",
  "espionage",
  "transport",
  "colonize",
  "harvest",
  "harvestAsteroid",
  "expedition",
  "pirateRaid",
  "alienRaid",
  "jump",
];

export type FleetDraft = {
  targetPlanetId: string | null;
  targetCoords: Coordinates | null;
  asteroidId: string | null;
  pirateBaseId: string | null;
  alienBaseId: string | null;
  mission: MissionType;
  counts: Partial<FleetShips>;
  cargo: Partial<Resources>;
  /** Joint Strike checkbox — kept across repaints. */
  openAcs: boolean;
};

function parseMission(raw: string | null | undefined): MissionType {
  if (raw && (MISSIONS as string[]).includes(raw)) return raw as MissionType;
  return "deploy";
}

/** Raid form state for a Joint Strike deep-link, before the fleet form exists. */
export function fleetDraftWithAcsPrefill(
  base: FleetDraft | null,
  prefill: AcsPrefill,
): FleetDraft {
  return {
    targetPlanetId: null,
    targetCoords: prefill.coords,
    asteroidId: null,
    pirateBaseId: null,
    alienBaseId: null,
    mission: prefill.mission,
    counts: base?.counts ?? {},
    cargo: base?.cargo ?? {},
    openAcs: prefill.openAcs,
  };
}

export function salvageFleetForm(root: HTMLElement): FleetDraft | null {
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return null;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  const missionEl = form.querySelector<HTMLInputElement>(
    'input[name="fleet-mission"]:checked',
  );
  const counts: Partial<FleetShips> = {};
  for (const id of SHIP_ORDER) {
    const input = form.querySelector<HTMLInputElement>(
      `[data-fleet-count="${id}"]`,
    );
    counts[id] = Math.max(0, Math.floor(Number(input?.value) || 0));
  }
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
  const value = target?.value ?? "";
  let targetPlanetId: string | null = null;
  let targetCoords: Coordinates | null = null;
  let asteroidId: string | null = null;
  let pirateBaseId: string | null = null;
  let alienBaseId: string | null = null;
  if (value.startsWith("planet:")) {
    targetPlanetId = value.slice("planet:".length);
  } else if (value.startsWith("asteroid:")) {
    asteroidId = value.slice("asteroid:".length);
  } else if (value.startsWith("pirate:")) {
    pirateBaseId = value.slice("pirate:".length);
  } else if (value.startsWith("alien:")) {
    alienBaseId = value.slice("alien:".length);
  } else if (value.startsWith("coords:")) {
    const [g, s, slot] = value
      .slice("coords:".length)
      .split(":")
      .map(Number);
    if (g && s && slot) targetCoords = { galaxy: g, system: s, slot };
  }
  return {
    targetPlanetId,
    targetCoords,
    asteroidId,
    pirateBaseId,
    alienBaseId,
    mission: parseMission(missionEl?.value),
    counts,
    cargo,
    openAcs: Boolean(
      form.querySelector<HTMLInputElement>("#fleet-open-acs")?.checked,
    ),
  };
}
