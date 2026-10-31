import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fleetComposer } from "./render-fleets-composer.js";
import { eventsBannerHtml } from "./render-events.js";
import { blankFleetDraft } from "./render-fleets-draft.js";
import type { PlayerView, FleetMission } from "@starhold/game";

function mockPlayerView(): PlayerView {
  return {
    now: 100_000_000,
    universe: { id: "u1", name: "Uni", speed: 1, fleetSpeed: 1 },
    player: {
      id: "p1",
      name: "Commander",
      homePlanetId: "pl1",
      activePlanetId: "pl1",
      planetIds: ["pl1"],
      level: 1,
      xpTotal: 0,
      createdAt: 100_000_000,
      research: {
        energyTech: 0,
        combustionDrive: 0,
        weaponsTech: 0,
        armourTech: 0,
        shieldingTech: 0,
        espionageTech: 0,
        astrophysics: 0,
        computerTech: 0,
        queueLogistics: 0,
        swarmHold: 0,
        gravityWell: 0,
        metallurgistTech: 0,
        crystalizerTech: 0,
        deutSynthesisTech: 0,
        researchNetwork: 0,
        cargoHoldTech: 0,
        fleetSpeedTech: 0,
      },
      playerClass: { classId: null, chosenAt: null, changeCount: 0, lastChangeAt: null },
      starshards: 0,
      officers: [],
      skillsUnlocked: [],
      skillLevels: {},
      officerLevels: {},
      officerRenewals: {},
      fleetPresets: [],
    },
    planet: {
      id: "pl1",
      name: "Home",
      ownerPlayerId: "p1",
      coords: { galaxy: 1, system: 1, slot: 4 },
      kind: "planet",
      parentPlanetId: null,
      moonId: null,
      fieldsCap: 200,
      resources: { metal: 1000, crystal: 1000, deuterium: 1000 },
      lastTickAt: 100_000_000,
      buildings: {
        metalMine: 1,
        crystalMine: 1,
        deutSynth: 1,
        solarPlant: 1,
        metalStorage: 1,
        crystalStorage: 1,
        deutTank: 1,
        shipyard: 1,
        researchLab: 1,
        lunarBase: 0,
        sensorArray: 0,
        jumpGate: 0,
        chronoLathe: 0,
        mantleLoom: 0,
        rigFoundry: 0,
        riftSiphon: 0,
        echoVault: 0,
        anomalyForge: 0,
        driftBeacon: 0,
      },
      ships: {
        scout: 5,
        hauler: 0,
        fastCargo: 0,
        bulkCargo: 0,
        interceptor: 0,
        cruiser: 0,
        bomber: 0,
        probe: 0,
        recycler: 0,
        colonyShip: 0,
        voidforgeTitan: 0,
        worldEater: 0,
        swarmDrone: 0,
        swarmHarvester: 0,
        swarmMothership: 1,
        helioBuoy: 0,
        keelSovereign: 0,
        rakeCorsair: 0,
        anvilDread: 0,
        wardbreaker: 0,
        vaultScout: 0,
        astrolabeWing: 0,
        spoilSkimmer: 0,
        lineDrummer: 0,
        veinAnchor: 0,
        gridStake: 0,
        foundationArk: 0,
        frontierBeacon: 0,
      },
      defenses: {
        laserBattery: 0,
        shieldDome: 0,
        needleTurret: 0,
        prismLaser: 0,
        arcLattice: 0,
        pulseBastion: 0,
        gaussRail: 0,
        ionSheath: 0,
        plasmaSpire: 0,
        flakCurtain: 0,
        kineticFence: 0,
        emberMortar: 0,
        rippleArray: 0,
        haloProjector: 0,
        crownAegis: 0,
        siegeBlockade: 0,
        frostLance: 0,
        voidWard: 0,
      },
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    },
    planetArt: { artId: "art1", artUrl: "/p.webp", artThumbUrl: "/pt.webp" },
    ownedPlanets: [],
    economy: {} as any,
    roster: [],
    highscores: [],
    galaxy: {
      galaxy: 1,
      system: 1,
      slots: [],
      minis: [
        {
          planetId: "mini1",
          name: "Drift Body 1:1:20",
          coords: { galaxy: 1, system: 1, slot: 20 },
          isOwn: false,
          playerName: null,
          debris: null,
          artId: "m1",
          artUrl: "/m.webp",
          artThumbUrl: "/mt.webp",
        },
      ],
      deepSpace: { coords: { galaxy: 1, system: 1, slot: 16 } },
      asteroids: [],
      pirateBase: null,
      alienBase: null,
    },
    fleets: [],
    fleetSlotCap: 5,
    expeditionSlotCap: 3,
    reports: [],
    spyReports: [],
    expeditionReports: [],
    sensorContacts: [],
    newbieBonusEndsAt: null,
    hostileInbound: [],
    starshards: 0,
    officers: [],
    skillsUnlocked: [],
    skillLevels: {},
    officerLevels: {},
    officerRenewals: {},
    researchTimeMult: 1,
    officerCatalog: [],
    skillCatalog: [],
    dailyLoginAvailable: false,
    progress: {} as any,
    occupation: null,
    alliance: null,
    allianceDirectory: [],
    openAcsGroups: [],
    goals: {} as any,
    seasonLeaderboard: {} as any,
    activeItemBuffs: [],
    shopCatalog: {},
  };
}

describe("Occupation UI rendering (B7-12)", () => {
  it("hides Occupation mission option when no Mothership is selected", () => {
    const view = mockPlayerView();
    const draft = {
      ...blankFleetDraft(),
      step: 2 as const,
      counts: { scout: 5, swarmMothership: 0 },
    };
    const html = fleetComposer(view, false, draft);
    assert.doesNotMatch(html, /data-testid="mission-occupy"/);
  });

  it("falls back to Deploy when Occupation is selected without a Mothership", () => {
    const view = mockPlayerView();
    const draft = {
      ...blankFleetDraft(),
      mission: "occupy" as const,
      step: 2 as const,
      counts: { scout: 5, swarmMothership: 0 },
    };
    const html = fleetComposer(view, false, draft);
    assert.doesNotMatch(html, /data-testid="mission-occupy"/);
    assert.doesNotMatch(html, /mission-tip-occupy/);
    assert.match(html, /<option value="deploy"[^>]*selected/);
  });

  it("shows Occupation mission option with red class when Mothership is selected", () => {
    const view = mockPlayerView();
    const draft = {
      ...blankFleetDraft(),
      step: 2 as const,
      counts: { swarmMothership: 1 },
    };
    const html = fleetComposer(view, false, draft);
    assert.match(html, /data-testid="mission-occupy"/);
    assert.match(html, /class="mission-occupy"/);
    assert.match(html, /Occupation \(Mothership\)/);
  });

  it("renders Occupation mission on the event banner in red", () => {
    const view = mockPlayerView();
    const fleet: FleetMission = {
      id: "flt_occ_1",
      ownerPlayerId: view.player.id,
      originPlanetId: view.planet.id,
      targetPlanetId: "mini1",
      targetPlayerId: null,
      targetCoords: { galaxy: 1, system: 1, slot: 20 },
      mission: "occupy",
      ships: { swarmMothership: 1 } as any,
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: 100_000_000,
      arrivesAt: 100_010_000,
      phase: "outbound",
      reportId: null,
    };
    view.fleets = [fleet];
    const bannerHtml = eventsBannerHtml(view, 100_000_000);
    assert.match(bannerHtml, /Occupation/);
    assert.match(bannerHtml, /mission-occupy/);
  });
});
