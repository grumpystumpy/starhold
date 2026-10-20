// Measure wait time while the host is actively running. A VM pause longer
// than five seconds is ignored instead of consuming the polling timeout.
//
// A shared 1s heartbeat keeps every clock updated while the script awaits a
// slow fetch or Playwright call, so only a real freeze (the event loop not
// running at all, e.g. a VM pause) shows up as a >5s gap and is skipped.
const MAX_GAP_MS = 5_000;
const clocks = new Set();
let ticker = null;

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    for (const c of clocks) c.update();
  }, 1_000);
  ticker.unref?.();
}

export function createActiveWaitClock() {
  const origin = Date.now();
  let last = origin;
  let elapsed = 0;
  const update = () => {
    const now = Date.now();
    const gap = now - last;
    if (gap <= MAX_GAP_MS) elapsed += Math.max(0, gap);
    last = now;
  };
  const clock = { update };
  clocks.add(clock);
  ensureTicker();
  return {
    elapsed() {
      update();
      return elapsed;
    },
    now() {
      update();
      return origin + elapsed;
    },
    stop() {
      clocks.delete(clock);
    },
  };
}
