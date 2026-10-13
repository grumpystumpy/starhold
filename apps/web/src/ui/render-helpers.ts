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
      return "Recommended next: raise the Lunar Base to expand moon fields.";
    }
    if (sensor < 1) {
      return "Recommended next: build a Sensor Phalanx to scan inbound fleets.";
    }
    if (gate < 1) {
      return "Recommended next: raise a Jump Gate to hop fleets between moons.";
    }
    return "Recommended next: park fleets here, jump to another moon, or watch Sensor contacts.";
  }
  const yard = planet.buildings.shipyard ?? 0;
  const lab = planet.buildings.researchLab ?? 0;
  const scouts = planet.ships.scout ?? 0;
  if (lab < 1) {
    return "Recommended next: raise the Research Lab, then unlock Espionage Tech.";
  }
  if (yard < 1) {
    return "Recommended next: raise the Shipyard (then bank a Scout / Probe).";
  }
  if (scouts < 1 && (planet.ships.probe ?? 0) < 1 && !planet.shipQueue) {
    return "Recommended next: build a Scout or Spy Probe, then open Fleets.";
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
