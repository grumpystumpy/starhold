import type { UniverseState, WhatsNewView } from "./types.js";

/** One deploy's notes. Order is oldest first; a later id is a newer release. */
export interface ReleaseNoteEntry {
  id: string;
  title: string;
  items: readonly string[];
}

/**
 * Release notes keyed by release id. Append a new entry for the next deploy.
 * The last id is the client build/release key players dismiss.
 */
export const RELEASE_NOTES: readonly ReleaseNoteEntry[] = [
  {
    id: "271",
    title: "What's new",
    items: [
      "Starhold can be added to an iPhone or Android home screen. On iPhone, use Share, then Add to Home Screen. Android shows Install app when the browser offers it.",
      "Sending a fleet includes a review of the mission, destination, flight time, and fuel before Send.",
      "Combat reports show each side's ships before the fight, the survivors, and the losses, and list loot and debris separately.",
      "Overview and Goals can suggest the next building, research, or ship that is still locked.",
      "A blocked build or fleet send shows the reason next to that button.",
    ],
  },
];

export const CURRENT_RELEASE_ID: string =
  RELEASE_NOTES[RELEASE_NOTES.length - 1]?.id ?? "";

/**
 * Notes whose id is later in the catalog than `dismissedReleaseId`.
 * A missing id, or one this build does not know, shows the whole catalog.
 */
export function releaseNotesNewerThan(
  notes: readonly ReleaseNoteEntry[],
  dismissedReleaseId: string | undefined,
): ReleaseNoteEntry[] {
  if (!dismissedReleaseId) return [...notes];
  const index = notes.findIndex((note) => note.id === dismissedReleaseId);
  if (index < 0) return [...notes];
  return notes.slice(index + 1);
}

/** Live popup. Does not write `player.whatsNewDismissedReleaseId`. */
export function whatsNewViewFor(player: {
  whatsNewDismissedReleaseId?: string;
}): WhatsNewView | null {
  const pending = releaseNotesNewerThan(
    RELEASE_NOTES,
    player.whatsNewDismissedReleaseId,
  );
  if (pending.length === 0) return null;
  const newest = pending[pending.length - 1]!;
  return {
    releaseId: newest.id,
    title: pending.length === 1 ? pending[0]!.title : "What's new",
    items: pending.flatMap((note) => [...note.items]),
  };
}

export type WhatsNewActionResult =
  | { ok: true; releaseId: string }
  | { ok: false; error: string };

/** Remember the current release key. Leaves fleets, resources, and onboarding alone. */
export function dismissWhatsNew(
  universe: UniverseState,
  playerId: string,
): WhatsNewActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  player.whatsNewDismissedReleaseId = CURRENT_RELEASE_ID;
  return { ok: true, releaseId: CURRENT_RELEASE_ID };
}
