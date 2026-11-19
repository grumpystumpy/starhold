import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SOUND_STORAGE_KEY,
  deliverSoundCues,
  forgetSoundBaseline,
  installSoundGestureArm,
  noteSoundGesture,
  observeViewSounds,
  readSoundEnabled,
  resetSoundSessionForTests,
  soundCuesBetween,
  writeSoundEnabled,
  type SoundCue,
  type SoundView,
} from "./settings.js";
import { soundSettingsHtml } from "./ui/sound-settings.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function view(
  playerId: string,
  fleets: SoundView["fleets"],
  reportIds: string[],
): SoundView {
  return {
    player: { id: playerId },
    fleets,
    reports: reportIds.map((id) => ({ id })),
  };
}

describe("sound setting", () => {
  it("stays off until the stored value is 1, including across a second read", () => {
    const store = memoryStorage();
    assert.equal(readSoundEnabled(store), false);
    assert.equal(readSoundEnabled(null), false);
    store.setItem(SOUND_STORAGE_KEY, "true");
    assert.equal(readSoundEnabled(store), false);
    writeSoundEnabled(true, store);
    assert.equal(store.getItem(SOUND_STORAGE_KEY), "1");
    assert.equal(readSoundEnabled(store), true);
    writeSoundEnabled(false, store);
    assert.equal(readSoundEnabled(store), false);
    assert.equal(store.getItem(SOUND_STORAGE_KEY), "0");
  });

  it("paints the settings switch off by default and on after the key is stored", () => {
    assert.match(soundSettingsHtml(), /data-testid="sound-settings"/);
    assert.match(soundSettingsHtml(), /data-testid="sound-toggle"/);
    assert.match(soundSettingsHtml(), />Sound off</);
    assert.match(soundSettingsHtml(), /aria-pressed="false"/);
    assert.match(soundSettingsHtml(), /aria-label="Settings, sound off"/);

    const store = memoryStorage();
    store.setItem(SOUND_STORAGE_KEY, "1");
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      configurable: true,
    });
    try {
      const on = soundSettingsHtml();
      assert.match(on, />Sound on</);
      assert.match(on, /aria-pressed="true"/);
    } finally {
      if (previous === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          value: previous,
          configurable: true,
        });
      }
    }
  });
});

describe("sound cues", () => {
  const home = {
    id: "fleet-1",
    phase: "returning" as const,
    ownerPlayerId: "p1",
  };

  it("cues a fleet that was returning and a combat report that is new", () => {
    const before = {
      playerId: "p1",
      fleets: [home, { id: "out", phase: "outbound" as const, ownerPlayerId: "p1" }],
      reportIds: ["old"],
    };
    const after = {
      playerId: "p1",
      fleets: [{ id: "out", phase: "outbound" as const, ownerPlayerId: "p1" }],
      reportIds: ["old", "fight-2"],
    };
    assert.deepEqual(soundCuesBetween(before, after), [
      "fleet-return",
      "combat-report",
    ]);
  });

  it("stays quiet for the first view, another commander, and a fleet that was not returning", () => {
    const first = {
      playerId: "p1",
      fleets: [home],
      reportIds: ["already"],
    };
    assert.deepEqual(soundCuesBetween(null, first), []);
    assert.deepEqual(
      soundCuesBetween(first, { ...first, playerId: "p2", fleets: [], reportIds: [] }),
      [],
    );
    const outbound = {
      playerId: "p1",
      fleets: [{ id: "gone", phase: "outbound" as const, ownerPlayerId: "p1" }],
      reportIds: [],
    };
    assert.deepEqual(
      soundCuesBetween(outbound, { playerId: "p1", fleets: [], reportIds: [] }),
      [],
    );
    const stranger = {
      playerId: "p1",
      fleets: [{ id: "npc", phase: "returning" as const, ownerPlayerId: "npc" }],
      reportIds: ["same"],
    };
    assert.deepEqual(
      soundCuesBetween(stranger, { playerId: "p1", fleets: [], reportIds: ["same"] }),
      [],
    );
  });

  it("does not call the sound player when muted", () => {
    const calls: SoundCue[] = [];
    deliverSoundCues(["fleet-return", "combat-report"], {
      enabled: false,
      gestured: true,
      play: (cue) => calls.push(cue),
    });
    assert.deepEqual(calls, []);
  });

  it("does not call the sound player before a user gesture", () => {
    const calls: SoundCue[] = [];
    deliverSoundCues(["fleet-return"], {
      enabled: true,
      gestured: false,
      play: (cue) => calls.push(cue),
    });
    assert.deepEqual(calls, []);
  });

  it("plays one cue of each kind after a gesture when sound is on", () => {
    const calls: SoundCue[] = [];
    deliverSoundCues(["fleet-return", "combat-report"], {
      enabled: true,
      gestured: true,
      play: (cue) => calls.push(cue),
    });
    assert.deepEqual(calls, ["fleet-return", "combat-report"]);
  });

  it("does not call the stub player from a view change while muted", () => {
    resetSoundSessionForTests();
    const calls: SoundCue[] = [];
    const play = (cue: SoundCue): void => {
      calls.push(cue);
    };
    observeViewSounds(view("p1", [home], ["old"]), {
      enabled: false,
      gestured: true,
      play,
    });
    observeViewSounds(view("p1", [], ["old", "fight-2"]), {
      enabled: false,
      gestured: true,
      play,
    });
    assert.deepEqual(calls, []);
    forgetSoundBaseline();
  });

  it("calls the stub player only after sound is enabled and a gesture was noted", () => {
    resetSoundSessionForTests();
    const calls: SoundCue[] = [];
    const play = (cue: SoundCue): void => {
      calls.push(cue);
    };
    const store = memoryStorage();
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      configurable: true,
    });
    const events: Record<string, () => void> = {};
    try {
      installSoundGestureArm({
        addEventListener(type, listener) {
          events[type] = listener;
        },
      });
      events.pointerdown?.();
      observeViewSounds(view("p1", [home], []), { play });
      observeViewSounds(view("p1", [], ["fight-9"]), { play });
      assert.deepEqual(calls, []);

      writeSoundEnabled(true, store);
      noteSoundGesture();
      observeViewSounds(view("p1", [], ["fight-9", "fight-10"]), { play });
      assert.deepEqual(calls, ["combat-report"]);
    } finally {
      resetSoundSessionForTests();
      if (previous === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          value: previous,
          configurable: true,
        });
      }
    }
  });
});
