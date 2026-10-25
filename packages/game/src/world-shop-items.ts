import type { ActiveItemBuff } from "./types-core.js";
import type {
  PlayerState,
  PlanetState,
  UniverseState,
} from "./types-view.js";
import { fieldsCap } from "./formulas-build.js";

export type ShopItemCategory =
  | "fields_planet"
  | "fields_moon"
  | "buff_hull"
  | "buff_armor"
  | "buff_shield"
  | "fleet_slots";

export type ShopItemTier = "S" | "M" | "L";

export interface ShopItemDefinition {
  id: string;
  name: string;
  category: ShopItemCategory;
  tier: ShopItemTier;
  bonus: number; // e.g. 5, 10, 15 for fields or +5, +10, +15 for buffs (+5 = 0.05) or 1, 2, 4 slots
  baseUnitCost: number; // cost 'c' per unit of bonus for tier S in this family
  starshards: number; // calculated starshard cost
  description: string;
}

// Micah's pricing rule (approved):
// S tier cost = c * bonus_S
// M & L tier cost = round(0.95 * c * bonus_tier)
export function computeShopItemCost(
  baseUnitCost: number,
  tier: ShopItemTier,
  bonus: number,
): number {
  if (tier === "S") {
    return Math.round(baseUnitCost * bonus);
  }
  return Math.round(0.95 * baseUnitCost * bonus);
}

export function computeShopItemPerUnitCost(item: ShopItemDefinition): number {
  return item.starshards / item.bonus;
}

export const SHOP_ITEMS: Record<string, ShopItemDefinition> = {
  // Planet Field Expansion S/M/L
  item_planet_fields_s: {
    id: "item_planet_fields_s",
    name: "Planet Field Expansion S",
    category: "fields_planet",
    tier: "S",
    bonus: 5,
    baseUnitCost: 20,
    starshards: computeShopItemCost(20, "S", 5), // 100
    description: "Permanently adds +5 fields capacity to the target planet.",
  },
  item_planet_fields_m: {
    id: "item_planet_fields_m",
    name: "Planet Field Expansion M",
    category: "fields_planet",
    tier: "M",
    bonus: 10,
    baseUnitCost: 20,
    starshards: computeShopItemCost(20, "M", 10), // round(0.95 * 20 * 10) = 190
    description: "Permanently adds +10 fields capacity to the target planet.",
  },
  item_planet_fields_l: {
    id: "item_planet_fields_l",
    name: "Planet Field Expansion L",
    category: "fields_planet",
    tier: "L",
    bonus: 20,
    baseUnitCost: 20,
    starshards: computeShopItemCost(20, "L", 20), // round(0.95 * 20 * 20) = 380
    description: "Permanently adds +20 fields capacity to the target planet.",
  },

  // Moon Field Expansion S/M/L
  item_moon_fields_s: {
    id: "item_moon_fields_s",
    name: "Moon Field Expansion S",
    category: "fields_moon",
    tier: "S",
    bonus: 3,
    baseUnitCost: 50,
    starshards: computeShopItemCost(50, "S", 3), // 150
    description: "Permanently adds +3 fields capacity to the target moon.",
  },
  item_moon_fields_m: {
    id: "item_moon_fields_m",
    name: "Moon Field Expansion M",
    category: "fields_moon",
    tier: "M",
    bonus: 6,
    baseUnitCost: 50,
    starshards: computeShopItemCost(50, "M", 6), // round(0.95 * 50 * 6) = 285
    description: "Permanently adds +6 fields capacity to the target moon.",
  },
  item_moon_fields_l: {
    id: "item_moon_fields_l",
    name: "Moon Field Expansion L",
    category: "fields_moon",
    tier: "L",
    bonus: 12,
    baseUnitCost: 50,
    starshards: computeShopItemCost(50, "L", 12), // round(0.95 * 50 * 12) = 570
    description: "Permanently adds +12 fields capacity to the target moon.",
  },

  // 24h Hull Buff +5% / +10% / +15%
  item_buff_hull_s: {
    id: "item_buff_hull_s",
    name: "Hull Reinforced Armor S",
    category: "buff_hull",
    tier: "S",
    bonus: 5,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "S", 5), // 150
    description: "Grants +5% Hull strength for 24 hours.",
  },
  item_buff_hull_m: {
    id: "item_buff_hull_m",
    name: "Hull Reinforced Armor M",
    category: "buff_hull",
    tier: "M",
    bonus: 10,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "M", 10), // round(0.95 * 30 * 10) = 285
    description: "Grants +10% Hull strength for 24 hours.",
  },
  item_buff_hull_l: {
    id: "item_buff_hull_l",
    name: "Hull Reinforced Armor L",
    category: "buff_hull",
    tier: "L",
    bonus: 15,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "L", 15), // round(0.95 * 30 * 15) = 428
    description: "Grants +15% Hull strength for 24 hours.",
  },

  // 24h Armor Buff +5% / +10% / +15%
  item_buff_armor_s: {
    id: "item_buff_armor_s",
    name: "Composite Armor Plating S",
    category: "buff_armor",
    tier: "S",
    bonus: 5,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "S", 5), // 150
    description: "Grants +5% Armor protection for 24 hours.",
  },
  item_buff_armor_m: {
    id: "item_buff_armor_m",
    name: "Composite Armor Plating M",
    category: "buff_armor",
    tier: "M",
    bonus: 10,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "M", 10), // round(0.95 * 30 * 10) = 285
    description: "Grants +10% Armor protection for 24 hours.",
  },
  item_buff_armor_l: {
    id: "item_buff_armor_l",
    name: "Composite Armor Plating L",
    category: "buff_armor",
    tier: "L",
    bonus: 15,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "L", 15), // round(0.95 * 30 * 15) = 428
    description: "Grants +15% Armor protection for 24 hours.",
  },

  // 24h Shield Buff +5% / +10% / +15%
  item_buff_shield_s: {
    id: "item_buff_shield_s",
    name: "Deflector Shield Booster S",
    category: "buff_shield",
    tier: "S",
    bonus: 5,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "S", 5), // 150
    description: "Grants +5% Shield capacity for 24 hours.",
  },
  item_buff_shield_m: {
    id: "item_buff_shield_m",
    name: "Deflector Shield Booster M",
    category: "buff_shield",
    tier: "M",
    bonus: 10,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "M", 10), // round(0.95 * 30 * 10) = 285
    description: "Grants +10% Shield capacity for 24 hours.",
  },
  item_buff_shield_l: {
    id: "item_buff_shield_l",
    name: "Deflector Shield Booster L",
    category: "buff_shield",
    tier: "L",
    bonus: 15,
    baseUnitCost: 30,
    starshards: computeShopItemCost(30, "L", 15), // round(0.95 * 30 * 15) = 428
    description: "Grants +15% Shield capacity for 24 hours.",
  },

  // 24h Fleet Slots +1 / +2 / +4
  item_fleet_slots_s: {
    id: "item_fleet_slots_s",
    name: "Fleet Logistics License S",
    category: "fleet_slots",
    tier: "S",
    bonus: 1,
    baseUnitCost: 200,
    starshards: computeShopItemCost(200, "S", 1), // 200
    description: "Grants +1 extra fleet slot for 24 hours.",
  },
  item_fleet_slots_m: {
    id: "item_fleet_slots_m",
    name: "Fleet Logistics License M",
    category: "fleet_slots",
    tier: "M",
    bonus: 2,
    baseUnitCost: 200,
    starshards: computeShopItemCost(200, "M", 2), // round(0.95 * 200 * 2) = 380
    description: "Grants +2 extra fleet slots for 24 hours.",
  },
  item_fleet_slots_l: {
    id: "item_fleet_slots_l",
    name: "Fleet Logistics License L",
    category: "fleet_slots",
    tier: "L",
    bonus: 4,
    baseUnitCost: 200,
    starshards: computeShopItemCost(200, "L", 4), // round(0.95 * 200 * 4) = 760
    description: "Grants +4 extra fleet slots for 24 hours.",
  },
};

export interface BuyShopItemParams {
  playerId: string;
  itemId: string;
  targetPlanetId?: string;
  now?: number;
}

export interface BuyShopItemResult {
  ok: boolean;
  error?: string;
}

export function buyShopItem(
  universe: UniverseState,
  params: BuyShopItemParams,
): BuyShopItemResult {
  const now = params.now ?? Date.now();
  const player: PlayerState | undefined = universe.players[params.playerId];
  if (!player) {
    return { ok: false, error: "Player not found." };
  }

  const item = SHOP_ITEMS[params.itemId];
  if (!item) {
    return { ok: false, error: "Unknown shop item." };
  }

  const shards = player.starshards ?? 0;
  if (shards < item.starshards) {
    return { ok: false, error: "Insufficient starshards." };
  }

  // Handle target validation for planet/moon field items
  if (item.category === "fields_planet" || item.category === "fields_moon") {
    if (!params.targetPlanetId) {
      return { ok: false, error: "Target planet or moon required." };
    }
    const planet: PlanetState | undefined =
      universe.planets[params.targetPlanetId];
    if (!planet || planet.ownerPlayerId !== player.id) {
      return { ok: false, error: "Target planet/moon not owned by player." };
    }

    if (item.category === "fields_planet" && planet.kind === "moon") {
      return { ok: false, error: "Planet field items cannot be applied to moons." };
    }
    if (item.category === "fields_moon" && planet.kind !== "moon") {
      return { ok: false, error: "Moon field items can only be applied to moons." };
    }

    // Deduct starshards and raise fieldsCap
    player.starshards = shards - item.starshards;
    planet.fieldsCap = fieldsCap(planet) + item.bonus;
    return { ok: true };
  }

  // Timed items (24h buffs or fleet slots)
  if (!player.itemBuffs) {
    player.itemBuffs = [];
  }

  // Clean up expired item buffs first
  player.itemBuffs = player.itemBuffs.filter((b: ActiveItemBuff) => b.expiresAt > now);

  // Reject if an active buff in the same category is already active
  const existingActive = player.itemBuffs.find(
    (b: ActiveItemBuff) => b.category === item.category && b.expiresAt > now,
  );
  if (existingActive) {
    return {
      ok: false,
      error: `An active buff for ${item.category.replace("_", " ")} is already active.`,
    };
  }

  // Deduct starshards and add active item buff
  player.starshards = shards - item.starshards;
  const durationMs = 24 * 60 * 60 * 1000;
  const newBuff: ActiveItemBuff = {
    itemId: item.id,
    category: item.category,
    bonus: item.bonus,
    expiresAt: now + durationMs,
  };
  player.itemBuffs.push(newBuff);

  return { ok: true };
}
