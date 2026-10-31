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
  "occupy",
];

export type FleetStep = 1 | 2;

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
  /** UI-only. 1 = ships, 2 = destination. Never sent to the server. */
  step: FleetStep;
  /**
   * Cruise preview, 10–100. Display only — launchFleet has no speed field.
   */
  speedPercent: number;
};

/** Last composer draft. Keeps step-2 fields while step 1 is on screen. */
let remembered: FleetDraft | null = null;
/** Next salvage returns a cleared step-1 draft (successful send). */
let suppressSalvage = false;

export function blankFleetDraft(): FleetDraft {
  return {
    targetPlanetId: null,
    targetCoords: null,
    asteroidId: null,
    pirateBaseId: null,
    alienBaseId: null,
    mission: "deploy",
    counts: {},
    cargo: {},
    openAcs: false,
    step: 1,
    speedPercent: 100,
  };
}

export function rememberFleetDraft(draft: FleetDraft | null): void {
  remembered = draft;
}

export function rememberedFleetDraft(): FleetDraft | null {
  return remembered;
}

/** After a successful send, the next paint must not restore the form. */
export function resetFleetComposer(): void {
  suppressSalvage = true;
  remembered = blankFleetDraft();
}

export function fleetShipTotal(counts: Partial<FleetShips> | null | undefined): number {
  let n = 0;
  for (const id of SHIP_ORDER) {
    n += Math.max(0, Math.floor(counts?.[id] ?? 0));
  }
  return n;
}

export function clampFleetSpeed(raw: number): number {
  if (!Number.isFinite(raw)) return 100;
  const stepped = Math.round(raw / 10) * 10;
  return Math.min(100, Math.max(10, stepped));
}

export function fleetDraftHasTarget(draft: FleetDraft | null): boolean {
  if (!draft) return false;
  return Boolean(
    draft.targetPlanetId ||
      draft.targetCoords ||
      draft.asteroidId ||
      draft.pirateBaseId ||
      draft.alienBaseId,
  );
}

/** Next is a no-op until at least one ship is selected. Amounts are kept. */
export function fleetDraftAfterNext(draft: FleetDraft): FleetDraft | null {
  if (fleetShipTotal(draft.counts) < 1) return null;
  return { ...draft, counts: { ...draft.counts }, cargo: { ...draft.cargo }, step: 2 };
}

/** Back keeps ships, cargo, mission, target, and speed. */
export function fleetDraftAfterBack(draft: FleetDraft): FleetDraft {
  return { ...draft, counts: { ...draft.counts }, cargo: { ...draft.cargo }, step: 1 };
}

/**
 * Preset load sets a mission and ship counts.
 * Ships selected → step 2. No ships → step 1. Destination already on the draft stays.
 */
export function fleetDraftAfterPreset(
  current: FleetDraft | null,
  mission: MissionType,
  counts: Partial<FleetShips>,
): FleetDraft {
  const base = current ?? blankFleetDraft();
  return {
    ...base,
    mission,
    counts: { ...counts },
    cargo: { ...base.cargo },
    step: fleetShipTotal(counts) > 0 ? 2 : 1,
  };
}

function parseMission(raw: string | null | undefined): MissionType {
  if (raw && (MISSIONS as string[]).includes(raw)) return raw as MissionType;
  return "deploy";
}

function readCargo(form: ParentNode): Partial<Resources> {
  return {
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
          form.querySelector<HTMLInputElement>("[data-cargo-deuterium]")
            ?.value,
        ) || 0,
      ),
    ),
  };
}

/** Raid form state for a Joint Strike deep-link, before the fleet form exists. */
export function fleetDraftWithAcsPrefill(
  base: FleetDraft | null,
  prefill: AcsPrefill,
): FleetDraft {
  const counts = { ...(base?.counts ?? {}) };
  return {
    targetPlanetId: null,
    targetCoords: prefill.coords,
    asteroidId: null,
    pirateBaseId: null,
    alienBaseId: null,
    mission: prefill.mission,
    counts,
    cargo: { ...(base?.cargo ?? {}) },
    openAcs: prefill.openAcs,
    speedPercent: base?.speedPercent ?? 100,
    // Coords (and a mission) are set. Step 2 only once ships are filled in.
    step: fleetShipTotal(counts) > 0 ? 2 : 1,
  };
}

export function salvageFleetForm(root: HTMLElement): FleetDraft | null {
  if (suppressSalvage) {
    suppressSalvage = false;
    remembered = blankFleetDraft();
    return remembered;
  }
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return null;
  const prior = remembered ?? blankFleetDraft();
  const stepAttr = form.getAttribute("data-fleet-step");
  const step: FleetStep = stepAttr === "2" ? 2 : 1;

  const counts: Partial<FleetShips> = {};
  const anyCount = form.querySelector("[data-fleet-count]");
  if (!anyCount) {
    Object.assign(counts, prior.counts);
  } else {
    for (const id of SHIP_ORDER) {
      const input = form.querySelector<HTMLInputElement>(
        `[data-fleet-count="${id}"]`,
      );
      counts[id] = Math.max(0, Math.floor(Number(input?.value) || 0));
    }
  }

  const missionEl = form.querySelector<HTMLInputElement | HTMLSelectElement>(
    '[name="fleet-mission"]',
  );
  const mission = missionEl ? parseMission(missionEl.value) : prior.mission;

  let targetPlanetId = prior.targetPlanetId;
  let targetCoords = prior.targetCoords;
  let asteroidId = prior.asteroidId;
  let pirateBaseId = prior.pirateBaseId;
  let alienBaseId = prior.alienBaseId;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  if (target) {
    targetPlanetId = null;
    targetCoords = null;
    asteroidId = null;
    pirateBaseId = null;
    alienBaseId = null;
    const value = target.value ?? "";
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
  }

  const cargo = form.querySelector("[data-cargo-metal]")
    ? readCargo(form)
    : { ...prior.cargo };
  const acs = form.querySelector<HTMLInputElement>("#fleet-open-acs");
  const speedEl = form.querySelector<HTMLSelectElement>("[data-fleet-speed]");
  const draft: FleetDraft = {
    targetPlanetId,
    targetCoords,
    asteroidId,
    pirateBaseId,
    alienBaseId,
    mission,
    counts,
    cargo,
    openAcs: acs ? Boolean(acs.checked) : prior.openAcs,
    step,
    speedPercent: speedEl
      ? clampFleetSpeed(Number(speedEl.value))
      : prior.speedPercent,
  };
  remembered = draft;
  return draft;
}
