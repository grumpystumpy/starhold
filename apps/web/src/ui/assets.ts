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
  mantleLoom: "/assets/buildings/mantle-loom.svg",
  rigFoundry: "/assets/buildings/rig-foundry.svg",
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
  helioBuoy: "/assets/ships/helio-buoy.svg",
  keelSovereign: "/assets/ships/keel-sovereign.svg",
  rakeCorsair: "/assets/ships/rake-corsair.svg",
  anvilDread: "/assets/ships/anvil-dread.svg",
  wardbreaker: "/assets/ships/wardbreaker.svg",
  vaultScout: "/assets/ships/vault-scout.svg",
  astrolabeWing: "/assets/ships/astrolabe-wing.svg",
  spoilSkimmer: "/assets/ships/spoil-skimmer.svg",
  lineDrummer: "/assets/ships/line-drummer.svg",
  veinAnchor: "/assets/ships/vein-anchor.svg",
  gridStake: "/assets/ships/grid-stake.svg",
  foundationArk: "/assets/ships/foundation-ark.svg",
  frontierBeacon: "/assets/ships/frontier-beacon.svg",
  voidforgeTitan: "/assets/ships/voidforge-titan.svg",
  worldEater: "/assets/ships/world-eater.svg",
  swarmDrone: "/assets/ships/swarm-drone.svg",
  swarmHarvester: "/assets/ships/swarm-harvester.svg",
  swarmMothership: "/assets/ships/swarm-mothership.svg",
};

export const DEFENSE_ART: Record<DefenseId, string> = {
  laserBattery: "/assets/defenses/laser-battery.svg",
  shieldDome: "/assets/defenses/shield-dome.svg",
  needleTurret: "/assets/defenses/needle-turret.svg",
  arcLattice: "/assets/defenses/arc-lattice.svg",
  pulseBastion: "/assets/defenses/pulse-bastion.svg",
  gaussRail: "/assets/defenses/gauss-rail.svg",
  ionSheath: "/assets/defenses/ion-sheath.svg",
  plasmaSpire: "/assets/defenses/plasma-spire.svg",
  flakCurtain: "/assets/defenses/flak-curtain.svg",
  kineticFence: "/assets/defenses/kinetic-fence.svg",
  emberMortar: "/assets/defenses/ember-mortar.svg",
  rippleArray: "/assets/defenses/ripple-array.svg",
  haloProjector: "/assets/defenses/halo-projector.svg",
  crownAegis: "/assets/defenses/crown-aegis.svg",
  siegeBlockade: "/assets/defenses/siege-blockade.svg",
  frostLance: "/assets/defenses/frost-lance.svg",
  voidWard: "/assets/defenses/void-ward.svg",
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
