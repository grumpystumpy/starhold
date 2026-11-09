import type { BuildingId, DefenseId, ResearchId, ShipId } from "@starhold/game";

/** Public Vite paths for plates (see public/assets/README.md and docs/ART_CREDITS.md). */
export const BUILDING_ART: Record<BuildingId, string> = {
  metalMine: "/assets/buildings/metal-mine.webp",
  crystalMine: "/assets/buildings/crystal-mine.webp",
  deutSynth: "/assets/buildings/deut-synth.webp",
  solarPlant: "/assets/buildings/solar-plant.webp",
  metalStorage: "/assets/buildings/metal-storage.webp",
  crystalStorage: "/assets/buildings/crystal-storage.webp",
  deutTank: "/assets/buildings/deut-tank.webp",
  shipyard: "/assets/buildings/shipyard.webp",
  researchLab: "/assets/buildings/research-lab.webp",
  lunarBase: "/assets/buildings/lunar-base.webp",
  sensorArray: "/assets/buildings/sensor-array.webp",
  jumpGate: "/assets/buildings/jump-gate.svg",
  chronoLathe: "/assets/buildings/chrono-lathe.svg",
  mantleLoom: "/assets/buildings/mantle-loom.svg",
  rigFoundry: "/assets/buildings/rig-foundry.svg",
  riftSiphon: "/assets/buildings/deut-synth.webp",
  echoVault: "/assets/buildings/metal-storage.webp",
  anomalyForge: "/assets/buildings/shipyard.webp",
  driftBeacon: "/assets/buildings/sensor-array.webp",
};

export const SHIP_ART: Record<ShipId, string> = {
  scout: "/assets/ships/scout.webp",
  hauler: "/assets/ships/hauler.webp",
  fastCargo: "/assets/ships/fast-cargo.webp",
  bulkCargo: "/assets/ships/bulk-cargo.webp",
  interceptor: "/assets/ships/interceptor.webp",
  cruiser: "/assets/ships/cruiser.webp",
  bomber: "/assets/ships/bomber.webp",
  probe: "/assets/ships/probe.webp",
  recycler: "/assets/ships/recycler.webp",
  colonyShip: "/assets/ships/colony-ship.webp",
  helioBuoy: "/assets/ships/helio-buoy.webp",
  keelSovereign: "/assets/ships/keel-sovereign.webp",
  rakeCorsair: "/assets/ships/rake-corsair.webp",
  anvilDread: "/assets/ships/anvil-dread.webp",
  wardbreaker: "/assets/ships/wardbreaker.webp",
  vaultScout: "/assets/ships/vault-scout.webp",
  astrolabeWing: "/assets/ships/astrolabe-wing.webp",
  spoilSkimmer: "/assets/ships/spoil-skimmer.webp",
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
  laserBattery: "/assets/defenses/laser-battery.webp",
  shieldDome: "/assets/defenses/shield-dome.svg",
  needleTurret: "/assets/defenses/needle-turret.webp",
  prismLaser: "/assets/defenses/prism-laser.webp",
  arcLattice: "/assets/defenses/arc-lattice.webp",
  pulseBastion: "/assets/defenses/pulse-bastion.webp",
  gaussRail: "/assets/defenses/gauss-rail.webp",
  ionSheath: "/assets/defenses/ion-sheath.svg",
  plasmaSpire: "/assets/defenses/plasma-spire.webp",
  flakCurtain: "/assets/defenses/flak-curtain.webp",
  kineticFence: "/assets/defenses/kinetic-fence.webp",
  emberMortar: "/assets/defenses/ember-mortar.webp",
  rippleArray: "/assets/defenses/ripple-array.webp",
  haloProjector: "/assets/defenses/halo-projector.svg",
  crownAegis: "/assets/defenses/crown-aegis.svg",
  siegeBlockade: "/assets/defenses/siege-blockade.webp",
  frostLance: "/assets/defenses/frost-lance.webp",
  voidWard: "/assets/defenses/void-ward.svg",
};

export const RESOURCE_ART = {
  metal: "/assets/resources/metal.svg",
  crystal: "/assets/resources/crystal.svg",
  deuterium: "/assets/resources/deuterium.svg",
  energy: "/assets/resources/energy.svg",
} as const;

export const PLANET_ART = {
  outpost: "/assets/planets/outpost.webp",
  rocky: "/assets/planets/rocky.webp",
  moon: "/assets/planets/moon.webp",
  /** Mini planet plate. Galaxy slots still use the procedural `/planet-art/` discs. */
  mini: "/assets/planets/mini.webp",
} as const;

/** Resolve body art; prefers mini → moon → outpost/rocky. */
export function planetArtFor(opts: {
  kind?: string | null;
  isMini?: boolean;
  flags?: { mini?: boolean } | null;
  variant?: "hero" | "chip";
}): string {
  if (opts.isMini || opts.flags?.mini) return PLANET_ART.mini;
  if (opts.kind === "moon") return PLANET_ART.moon;
  return opts.variant === "chip" ? PLANET_ART.rocky : PLANET_ART.outpost;
}

export const UI_ART = {
  emptyHangar: "/assets/ui/empty-hangar.svg",
} as const;

export const RESEARCH_ART: Record<ResearchId, string> = {
  energyTech: "/assets/research/power-discipline.svg",
  combustionDrive: "/assets/research/pulse-drive.svg",
  weaponsTech: "/assets/research/ordnance-doctrine.svg",
  armourTech: "/assets/research/hull-weave.svg",
  shieldingTech: "/assets/research/aegis-lattice.svg",
  espionageTech: "/assets/research/shadow-optics.svg",
  astrophysics: "/assets/research/stellar-cartography.svg",
  computerTech: "/assets/research/fleet-os.svg",
  queueLogistics: "/assets/research/yard-logistics.svg",
  swarmHold: "/assets/research/swarm-hold.svg",
  gravityWell: "/assets/research/well-binding.svg",
  metallurgistTech: "/assets/research/metallurgist.svg",
  crystalizerTech: "/assets/research/crystal-refining.svg",
  deutSynthesisTech: "/assets/research/deut-synthesis.svg",
  researchNetwork: "/assets/research/research-network.svg",
  cargoHoldTech: "/assets/research/cargo-hold.svg",
  fleetSpeedTech: "/assets/research/fleet-thrusters.svg",
};

/** Full-bleed backgrounds. Not used as HUD icons. */
export const BACKGROUND_ART = {
  galaxy: "/assets/backgrounds/kenney-sky-galaxy.webp",
  join: "/assets/backgrounds/nasa-earthrise.webp",
} as const;
