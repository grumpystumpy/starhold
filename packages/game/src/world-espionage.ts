import { espionageDetail } from "./formulas.js";
import type {
  EspionageReport,
  FleetMission,
  PlanetState,
  UniverseState,
} from "./types.js";

export function resolveEspionage(
  universe: UniverseState,
  fleet: FleetMission,
  target: PlanetState,
  now: number,
): void {
  const spy = universe.players[fleet.ownerPlayerId];
  const targetOwner = universe.players[target.ownerPlayerId];
  if (!spy || !targetOwner) return;

  const detail = espionageDetail(
    spy.research.espionageTech ?? 0,
    target.buildings.researchLab ?? 0,
  );
  const reportId = `spy_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const report: EspionageReport = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    spyPlayerId: spy.id,
    targetPlayerId: targetOwner.id,
    targetName: targetOwner.name,
    targetCoords: { ...target.coords },
    detail,
    resources: detail >= 1 ? { ...target.resources } : null,
    ships: detail >= 2 ? { ...target.ships } : null,
    defenses: detail >= 2 ? { ...target.defenses } : null,
    buildings: detail >= 3 ? { ...target.buildings } : null,
    research: detail >= 3 ? { ...targetOwner.research } : null,
    summary:
      detail <= 0
        ? `Sensors jammed over ${targetOwner.name}'s world — almost nothing learned.`
        : detail === 1
          ? `Resource scan of ${targetOwner.name} succeeded.`
          : detail === 2
            ? `Fleet/defense scan of ${targetOwner.name} succeeded.`
            : `Full structural scan of ${targetOwner.name} succeeded.`,
  };
  universe.spyReports[reportId] = report;
  fleet.reportId = reportId;
}
