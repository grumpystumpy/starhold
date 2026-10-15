import type {
  BuildingId,
  Coordinates,
  DefenseId,
  FleetShips,
  MissionType,
  PlayerView,
  ResearchId,
  Resources,
  ShipId,
} from "@starhold/game";

/** Session path hint so mines-first play still sees yard → scout → fleet mission. */
export function recommendedNext(view: PlayerView): string {
  const planet = view.planet;
  if (planet.kind === "moon") {
    const lunar = planet.buildings.lunarBase ?? 0;
    const sensor = planet.buildings.sensorArray ?? 0;
    const gate = planet.buildings.jumpGate ?? 0;
    if (lunar < 1) {
      return "Recommended next: raise the Crater Hab to expand moon fields.";
    }
    if (sensor < 1) {
      return "Recommended next: build a Horizon Scanner to scan inbound fleets.";
    }
    if (gate < 1) {
      return "Recommended next: raise a Fold Bridge to hop fleets between moons.";
    }
    return "Recommended next: park fleets here, jump to another moon, or watch Horizon Scanner contacts.";
  }
  if (planet.flags?.mini) {
    const siphon = planet.buildings.riftSiphon ?? 0;
    const vault = planet.buildings.echoVault ?? 0;
    const forge = planet.buildings.anomalyForge ?? 0;
    const beacon = planet.buildings.driftBeacon ?? 0;
    const yard = planet.buildings.shipyard ?? 0;
    if (siphon < 1) {
      return "Recommended next: raise a Rift Siphon to boost this mini's output.";
    }
    if (vault < 1) {
      return "Recommended next: raise an Echo Vault for storage headroom.";
    }
    if (forge < 1) {
      return "Recommended next: raise an Anomaly Forge to speed ship builds here.";
    }
    if (beacon < 1) {
      return "Recommended next: raise a Drift Beacon for +1 expedition slot.";
    }
    if (yard < 1) {
      return "Recommended next: raise the Shipyard on this mini colony.";
    }
    return "Recommended next: defend this mini or use World Eaters carefully — rivals can capture or destroy it.";
  }
  const yard = planet.buildings.shipyard ?? 0;
  const lab = planet.buildings.researchLab ?? 0;
  const scouts = planet.ships.scout ?? 0;
  if (lab < 1) {
    return "Recommended next: raise the Research Lab, then unlock Shadow Optics.";
  }
  if (yard < 1) {
    return "Recommended next: raise the Shipyard (then bank a Scout / Probe).";
  }
  if (scouts < 1 && (planet.ships.probe ?? 0) < 1 && !(planet.shipQueue?.length ?? 0)) {
    return "Recommended next: build a Scout or Whisper Probe, then open Fleets.";
  }
  return "Recommended next: browse Galaxy, spy or raid a rival, or colonize an empty slot.";
}

export type UiHandlers = {
  onJoinDraft: (name: string) => void;
  onJoin: (name: string) => void;
  onUpgrade: (buildingId: BuildingId) => void;
  onBuildShip: (shipId: ShipId, count: number) => void;
  onBuildDefense: (defenseId: DefenseId, count: number) => void;
  onResearch: (researchId: ResearchId) => void;
  onSelectPlanet: (planetId: string) => void;
  onGalaxyNav: (dir: "prev" | "next") => void;
  onLaunchFleet: (opts: {
    mission: MissionType;
    ships: Partial<FleetShips>;
    targetPlanetId?: string;
    targetCoords?: Coordinates;
    asteroidId?: string;
    pirateBaseId?: string;
    cargo?: Partial<Resources>;
  }) => void;
  onRefresh: () => void;
  onDismissFlash: () => void;
};
