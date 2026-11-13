import type { FleetPhase } from "@starhold/game";

/** Local only. Missing or any value other than `1` means off. Not a save field. */
export const SOUND_STORAGE_KEY = "starhold-sound";

export type SoundCue = "fleet-return" | "combat-report";

export interface SoundFleet {
  id: string;
  phase: FleetPhase;
  ownerPlayerId: string;
}

export interface SoundView {
  player: { id: string };
  fleets: SoundFleet[];
  reports: Array<{ id: string }>;
}

interface SoundSnapshot {
  playerId: string;
  fleets: SoundFleet[];
  reportIds: string[];
}

export interface SoundDelivery {
  enabled: boolean;
  gestured: boolean;
  play: (cue: SoundCue) => void;
}

function browserStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== "function") return null;
    return storage;
  } catch {
    return null;
  }
}

export function readSoundEnabled(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SOUND_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSoundEnabled(
  enabled: boolean,
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SOUND_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* Private mode can reject the write. The switch stays off. */
  }
}

export function soundCuesBetween(
  previous: SoundSnapshot | null,
  next: SoundSnapshot,
): SoundCue[] {
  if (!previous || previous.playerId !== next.playerId) return [];
  const cues: SoundCue[] = [];
  const stillOut = new Set(next.fleets.map((fleet) => fleet.id));
  const returned = previous.fleets.some(
    (fleet) =>
      fleet.ownerPlayerId === previous.playerId &&
      fleet.phase === "returning" &&
      fleet.id !== "" &&
      !stillOut.has(fleet.id),
  );
  if (returned) cues.push("fleet-return");
  const seen = new Set(previous.reportIds);
  const combat = next.reportIds.some((id) => id !== "" && !seen.has(id));
  if (combat) cues.push("combat-report");
  return cues;
}

/** Muted or not-yet-gestured playback never calls `play`. */
export function deliverSoundCues(
  cues: readonly SoundCue[],
  options: SoundDelivery,
): void {
  if (!options.enabled || !options.gestured || cues.length === 0) return;
  for (const cue of cues) options.play(cue);
}

let previous: SoundSnapshot | null = null;
let gestured = false;
let audioContext: AudioContext | null = null;

function snapshot(view: SoundView): SoundSnapshot {
  return {
    playerId: view.player.id,
    fleets: view.fleets.map((fleet) => ({
      id: fleet.id,
      phase: fleet.phase,
      ownerPlayerId: fleet.ownerPlayerId,
    })),
    reportIds: view.reports.map((report) => report.id),
  };
}

export function forgetSoundBaseline(): void {
  previous = null;
}

export function resetSoundSessionForTests(): void {
  previous = null;
  gestured = false;
  audioContext = null;
}

export function noteSoundGesture(): void {
  gestured = true;
  if (!readSoundEnabled()) return;
  unlockGeneratedAudio();
}

export function installSoundGestureArm(target: {
  addEventListener(type: string, listener: () => void): void;
} | null): void {
  if (!target) return;
  const arm = (): void => {
    if (!readSoundEnabled()) return;
    noteSoundGesture();
  };
  target.addEventListener("pointerdown", arm);
  target.addEventListener("keydown", arm);
}

function audioCtor(): typeof AudioContext | null {
  const host = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return host.AudioContext ?? host.webkitAudioContext ?? null;
}

function unlockGeneratedAudio(): void {
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }
  } catch {
    audioContext = null;
  }
}

function tone(
  ctx: AudioContext,
  frequency: number,
  when: number,
  duration: number,
  level: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(level, when + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

/** Short sine tones. No audio file, so there is nothing to license. */
export function playGeneratedCue(cue: SoundCue): void {
  const ctx = audioContext;
  if (!ctx) return;
  const start = (): void => {
    const at = ctx.currentTime;
    switch (cue) {
      case "fleet-return":
        tone(ctx, 523.25, at, 0.09, 0.05);
        tone(ctx, 659.25, at + 0.1, 0.14, 0.045);
        break;
      case "combat-report":
        tone(ctx, 220, at, 0.08, 0.05);
        tone(ctx, 146.83, at + 0.09, 0.16, 0.04);
        break;
      default: {
        const neverCue: never = cue;
        void neverCue;
      }
    }
  };
  try {
    if (ctx.state === "suspended") {
      void ctx.resume().then(start).catch(() => {});
      return;
    }
    start();
  } catch {
    /* A missing output device stays silent. */
  }
}

export function observeViewSounds(
  view: SoundView,
  deps?: {
    enabled?: boolean;
    gestured?: boolean;
    play?: (cue: SoundCue) => void;
  },
): void {
  const next = snapshot(view);
  const cues = soundCuesBetween(previous, next);
  previous = next;
  deliverSoundCues(cues, {
    enabled: deps?.enabled ?? readSoundEnabled(),
    gestured: deps?.gestured ?? gestured,
    play: deps?.play ?? playGeneratedCue,
  });
}
