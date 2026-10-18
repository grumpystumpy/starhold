import type {
  Coordinates,
  FleetPresetIntent,
  FleetShips,
  MissionType,
  Resources,
} from "@starhold/game";
import { SHIP_ORDER } from "@starhold/game";
import {
  deleteFleetPresetRequest,
  launchFleetMission,
  launchMaxExpeditionsRequest,
  saveFleetPresetRequest,
  scanSystemRequest,
} from "./api";
import {
  clearFlash,
  root,
  schedulePaint,
  session,
  setFlash,
} from "./session";
import { captureGameEvent } from "./telemetry";
import { settleMutation } from "./recover-action";

function intentMission(intent: FleetPresetIntent): MissionType {
  switch (intent) {
    case "expedition":
      return "expedition";
    case "raid":
    case "moonDestruction":
    case "miniCapture":
    case "miniDestroy":
      return "raid";
    case "custom":
      return "deploy";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

function fleetNotice(view: NonNullable<typeof session.view>, mission: MissionType): string {
  const live = view.fleets?.[0];
  return live
    ? `Fleet ${live.mission} launched · ETA ${Math.ceil((live.arrivesAt - view.now) / 1000)}s.`
    : `Fleet ${mission} launched.`;
}

function expeditionNotice(view: NonNullable<typeof session.view>, before: number): string {
  const launched = Math.max(
    0,
    view.fleets.filter((f) => f.mission === "expedition").length - before,
  );
  return launched > 0
    ? `Sent ${launched} expedition${launched === 1 ? "" : "s"} (Expedition preset).`
    : "No new expeditions launched.";
}

function scanNotice(view: NonNullable<typeof session.view>, before: number): string {
  const launched = Math.max(
    0,
    view.fleets.filter((f) => f.mission === "espionage").length - before,
  );
  return launched > 0
    ? `Scanning ${launched} owned planet${launched === 1 ? "" : "s"} with Whisper Probes.`
    : "No scans launched.";
}

export async function doLaunchFleet(opts: {
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
}): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  captureGameEvent("fleet_send", { mission: opts.mission });
  try {
    session.view = await launchFleetMission(session.view.player.id, opts);
    setFlash("notice", fleetNotice(session.view, opts.mission));
  } catch (err) {
    const before = new Set((session.view?.fleets ?? []).map((fleet) => fleet.id));
    await settleMutation({
      err,
      failureFallback: "Launch failed.",
      applied: (view) => view.fleets.some((fleet) => !before.has(fleet.id)),
      successNotice: (view) => fleetNotice(view, opts.mission),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export function doApplyFleetPreset(): void {
  if (!session.view) return;
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  const select = root.querySelector<HTMLSelectElement>("#fleet-preset");
  if (!form || !select?.value) {
    setFlash("error", "Pick a fleet preset to load.");
    schedulePaint();
    return;
  }
  const preset = session.view.player.fleetPresets?.find(
    (p) => p.id === select.value,
  );
  if (!preset) {
    setFlash("error", "Unknown preset.");
    schedulePaint();
    return;
  }

  const mission = intentMission(preset.intent);
  const radio = form.querySelector<HTMLInputElement>(
    `input[name="fleet-mission"][value="${mission}"]`,
  );
  if (radio) radio.checked = true;

  for (const id of SHIP_ORDER) {
    const input = form.querySelector<HTMLInputElement>(
      `[data-fleet-count="${id}"]`,
    );
    if (!input) continue;
    const have = Math.max(0, Math.floor(Number(input.max) || 0));
    const want = Math.max(0, Math.floor(preset.ships[id] ?? 0));
    input.value = String(Math.min(have, want));
  }

  const nameInput = root.querySelector<HTMLInputElement>("#fleet-preset-name");
  if (nameInput && !preset.builtIn) nameInput.value = preset.name;

  setFlash("notice", `Loaded preset “${preset.name}”.`);
  schedulePaint();
}

export async function doSaveFleetPreset(): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  const select = root.querySelector<HTMLSelectElement>("#fleet-preset");
  const nameInput = root.querySelector<HTMLInputElement>("#fleet-preset-name");
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return;

  const ships: Partial<FleetShips> = {};
  for (const id of SHIP_ORDER) {
    const input = form.querySelector<HTMLInputElement>(
      `[data-fleet-count="${id}"]`,
    );
    const n = Math.max(0, Math.floor(Number(input?.value) || 0));
    if (n > 0) ships[id] = n;
  }

  const selectedId = select?.value || undefined;
  const selected = selectedId
    ? session.view.player.fleetPresets?.find((p) => p.id === selectedId)
    : undefined;
  const name =
    nameInput?.value.trim() ||
    selected?.name ||
    (selected?.builtIn ? selected.name : "");

  if (!name) {
    setFlash("error", "Enter a name to save a custom preset (or select a built-in to update its ships).");
    schedulePaint();
    return;
  }

  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await saveFleetPresetRequest(session.view.player.id, {
      id: selected?.builtIn || selected ? selectedId : undefined,
      name,
      ships,
    });
    setFlash("notice", `Saved preset “${name}”.`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not save preset.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doDeleteFleetPreset(): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  const select = root.querySelector<HTMLSelectElement>("#fleet-preset");
  const id = select?.value;
  if (!id) {
    setFlash("error", "Select a custom preset to delete.");
    schedulePaint();
    return;
  }
  const preset = session.view.player.fleetPresets?.find((p) => p.id === id);
  if (!preset || preset.builtIn) {
    setFlash("error", "Only custom presets can be deleted.");
    schedulePaint();
    return;
  }

  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await deleteFleetPresetRequest(session.view.player.id, id);
    setFlash("notice", `Deleted preset “${preset.name}”.`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not delete preset.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doLaunchMaxExpeditions(): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const before = session.view.fleets.filter((f) => f.mission === "expedition")
      .length;
    session.view = await launchMaxExpeditionsRequest(session.view.player.id, {
      galaxy: session.view.galaxy.galaxy,
      system: session.view.galaxy.system,
      originPlanetId: session.view.planet.id,
    });
    setFlash("notice", expeditionNotice(session.view, before));
  } catch (err) {
    const before = session.view?.fleets.filter((f) => f.mission === "expedition").length ?? 0;
    await settleMutation({
      err,
      failureFallback: "Max expeditions failed.",
      applied: (view) =>
        view.fleets.filter((f) => f.mission === "expedition").length > before,
      successNotice: (view) => expeditionNotice(view, before),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doScanSystem(): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const before = session.view.fleets.filter((f) => f.mission === "espionage")
      .length;
    session.view = await scanSystemRequest(session.view.player.id, {
      galaxy: session.view.galaxy.galaxy,
      system: session.view.galaxy.system,
      originPlanetId: session.view.planet.id,
    });
    setFlash("notice", scanNotice(session.view, before));
  } catch (err) {
    const before = session.view?.fleets.filter((f) => f.mission === "espionage").length ?? 0;
    await settleMutation({
      err,
      failureFallback: "Scan failed.",
      applied: (view) =>
        view.fleets.filter((f) => f.mission === "espionage").length > before,
      successNotice: (view) => scanNotice(view, before),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
