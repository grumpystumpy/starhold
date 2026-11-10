import type { Coordinates, MissionType, PlayerView } from "@starhold/game";

/** Raid and occupy are the missions that fight another commander. */
function isAttackMission(mission: string): boolean {
  return mission === "raid" || mission === "occupy";
}

function pactTags(view: PlayerView): Set<string> {
  const tags = new Set<string>();
  for (const row of view.alliance?.relations ?? []) {
    if (row.kind === "nap" && row.status === "active" && row.tag) tags.add(row.tag);
  }
  return tags;
}

function stanceForTarget(
  view: PlayerView,
  planetId: string | null | undefined,
  coords: Coordinates | null | undefined,
): { diplomacy?: "nap" | "war"; tag: string | null } {
  const slots = view.galaxy?.slots ?? [];
  const slot = planetId
    ? slots.find((row) => row.planetId === planetId || row.moonId === planetId)
    : coords
      ? slots.find(
          (row) =>
            row.coords.galaxy === coords.galaxy &&
            row.coords.system === coords.system &&
            row.coords.slot === coords.slot,
        )
      : undefined;
  if (slot && !slot.isOwn && (slot.diplomacy === "nap" || slot.diplomacy === "war" || slot.allianceTag)) {
    return { diplomacy: slot.diplomacy, tag: slot.allianceTag };
  }
  if (planetId) {
    const mini = view.galaxy?.minis?.find((row) => row.planetId === planetId);
    if (mini && !mini.isOwn && (mini.diplomacy === "nap" || mini.diplomacy === "war")) {
      return { diplomacy: mini.diplomacy, tag: null };
    }
    const rival = view.roster?.find((row) => row.planetId === planetId && row.id !== view.player.id);
    if (rival?.allianceTag) return { tag: rival.allianceTag };
  }
  return { tag: null };
}

/**
 * Warning copy when an attack targets an active NAP partner.
 * Null means send with no extra confirm. War and a pending pact do not warn.
 */
export function napAttackWarning(
  view: PlayerView,
  target: {
    mission: MissionType | string;
    planetId?: string | null;
    coords?: Coordinates | null;
  },
): string | null {
  if (!isAttackMission(target.mission)) return null;
  const found = stanceForTarget(view, target.planetId, target.coords);
  if (found.diplomacy === "war") return null;
  const tags = pactTags(view);
  const partner = found.diplomacy === "nap" || (found.tag != null && tags.has(found.tag));
  if (!partner) return null;
  const who = found.tag ? `[${found.tag}]` : "this alliance";
  return `Non-aggression pact with ${who}. This attack is allowed. Send it anyway?`;
}

/** Send stays available. Stop only when the player dismisses the confirm. */
export function napAttackDecision(
  warning: string | null,
  confirm: ((message: string) => boolean) | undefined,
): "send" | "stop" {
  if (warning == null || warning === "") return "send";
  if (typeof confirm !== "function") return "send";
  return confirm(warning) ? "send" : "stop";
}
