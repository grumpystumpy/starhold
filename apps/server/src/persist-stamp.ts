import type { UniverseState } from "@starhold/game";
import { addCpu } from "./request-context.js";

/**
 * Structural fingerprint of a universe. Resource floats and `lastTickAt`
 * are omitted so a quiet poll can skip the D1 write. Queue lengths, ship
 * and defense totals, raid clocks, and the seed cursor are included.
 */
export function structuralStamp(universe: UniverseState): string {
  const started = performance.now();
  try {
    let h = 2166136261;
    const mix = (n: number) => {
      h = Math.imul(h ^ (n | 0), 16777619);
    };
    const mixStr = (text: string | undefined) => {
      if (!text) return;
      for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i));
    };
    const sum = (obj: Record<string, number> | undefined): number => {
      if (!obj) return 0;
      let n = 0;
      for (const value of Object.values(obj)) n += value;
      return n;
    };

    mixStr(universe.id);
    mix(universe.schemaVersion ?? 0);
    const cursor = universe.seedCursor;
    mix(cursor?.at ?? -1);
    mix(cursor?.pirates ?? 0);
    mix(cursor?.done ? 1 : 0);
    mix(cursor?.ranks?.length ?? 0);
    mix(cursor?.rankAt ?? 0);

    const players = Object.values(universe.players);
    mix(players.length);
    for (const player of players) {
      mixStr(player.id);
      mix(player.starshards ?? 0);
      mix(player.planetIds?.length ?? 0);
      mix(player.researchQueue?.length ?? 0);
      mix(sum(player.research as unknown as Record<string, number>));
    }

    const planets = Object.values(universe.planets);
    mix(planets.length);
    for (const planet of planets) {
      mixStr(planet.id);
      mix(planet.buildQueue?.length ?? 0);
      mix(planet.shipQueue?.length ?? 0);
      mix(planet.defenseQueue?.length ?? 0);
      mix(sum(planet.buildings));
      mix(sum(planet.ships));
      mix(sum(planet.defenses));
    }

    const fleets = Object.values(universe.fleets ?? {});
    mix(fleets.length);
    for (const fleet of fleets) {
      mixStr(fleet.id);
      mix(fleet.arrivesAt);
    }
    mix(Object.keys(universe.reports ?? {}).length);
    mix(Object.keys(universe.spyReports ?? {}).length);
    mix(Object.keys(universe.expeditionReports ?? {}).length);
    mix(Object.keys(universe.debris ?? {}).length);
    mix(Object.keys(universe.asteroids ?? {}).length);
    mix(Object.keys(universe.occupations ?? {}).length);
    mix(universe.miniPlanetIds?.length ?? 0);

    for (const base of Object.values(universe.pirateBases ?? {})) {
      mixStr(base.id);
      mix(base.level);
      mix(base.nextRaidAt);
      mix(base.destroyedAt ?? 0);
      mix(sum(base.ships));
    }
    for (const base of Object.values(universe.alienBases ?? {})) {
      mixStr(base.id);
      mix(base.level);
      mix(base.nextRaidAt);
      mix(base.destroyedAt ?? 0);
    }

    return (h >>> 0).toString(16);
  } finally {
    addCpu(performance.now() - started);
  }
}
