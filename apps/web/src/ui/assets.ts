import type { BuildingId, DefenseId, ShipId } from "@starhold/game";

/** Public Vite paths for original SVG plates (see public/assets/README.md). */
export const BUILDING_ART: Record<BuildingId, string> = {
  metalMine: "/assets/buildings/metal-mine.svg",
  crystalMine: "/assets/buildings/crystal-mine.svg",
  deutSynth: "/assets/buildings/deut-synth.svg",
  solarPlant: "/assets/buildings/solar-plant.svg",
  metalStorage: "/assets/buildings/metal-storage.svg",
  crystalStorage: "/assets/buildings/crystal-storage.svg",
  deutTank: "/assets/buildings/deut-tank.svg",
  shipyard: "/assets/buildings/shipyard.svg",
  researchLab: "/assets/buildings/research-lab.svg",
  lunarBase: "/assets/buildings/lunar-base.svg",
  sensorArray: "/assets/buildings/sensor-array.svg",
  jumpGate: "/assets/buildings/jump-gate.svg",
  chronoLathe: "/assets/buildings/chrono-lathe.svg",
};

export const SHIP_ART: Record<ShipId, string> = {
  scout: "/assets/ships/scout.svg",
  hauler: "/assets/ships/hauler.svg",
  interceptor: "/assets/ships/interceptor.svg",
  cruiser: "/assets/ships/cruiser.svg",
  bomber: "/assets/ships/bomber.svg",
  probe: "/assets/ships/probe.svg",
  recycler: "/assets/ships/recycler.svg",
  colonyShip: "/assets/ships/colony-ship.svg",
  voidforgeTitan: "/assets/ships/voidforge-titan.svg",
  worldEater: "/assets/ships/world-eater.svg",
  swarmDrone: "/assets/ships/swarm-drone.svg",
  swarmHarvester: "/assets/ships/swarm-harvester.svg",
  swarmMothership: "/assets/ships/swarm-mothership.svg",
};

export const DEFENSE_ART: Record<DefenseId, string> = {
  laserBattery: "/assets/defenses/laser-battery.svg",
  shieldDome: "/assets/defenses/shield-dome.svg",
};

export const RESOURCE_ART = {
  metal: "/assets/resources/metal.svg",
  crystal: "/assets/resources/crystal.svg",
  deuterium: "/assets/resources/deuterium.svg",
  energy: "/assets/resources/energy.svg",
} as const;

export const PLANET_ART = {
  outpost: "/assets/planets/outpost.svg",
  rocky: "/assets/planets/rocky.svg",
  moon: "/assets/planets/moon.svg",
} as const;

export const UI_ART = {
  emptyHangar: "/assets/ui/empty-hangar.svg",
} as const;
