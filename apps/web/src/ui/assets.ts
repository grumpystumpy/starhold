import type { BuildingId, ShipId } from "@starhold/game";

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
};

export const SHIP_ART: Record<ShipId, string> = {
  scout: "/assets/ships/scout.svg",
  hauler: "/assets/ships/hauler.svg",
  interceptor: "/assets/ships/interceptor.svg",
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
} as const;

export const DEFENSE_ART = {
  laser: "/assets/defenses/laser-battery.svg",
  shield: "/assets/defenses/shield-dome.svg",
} as const;

export const UI_ART = {
  emptyHangar: "/assets/ui/empty-hangar.svg",
} as const;
