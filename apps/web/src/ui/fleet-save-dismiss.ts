const STORAGE_KEY = "starhold-fleet-save-dismissed";
const MAX_IDS = 40;
const ids = new Set<string>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const id of parsed) {
      if (typeof id === "string" && id) ids.add(id);
    }
  } catch {
    // A broken browser store still leaves the in-memory set usable.
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-MAX_IDS)));
  } catch {
    // Private mode can reject writes. The reminder stays dismissed this visit.
  }
}

export function isFleetSaveDismissed(attackId: string): boolean {
  load();
  return ids.has(attackId);
}

export function dismissFleetSave(attackId: string): void {
  load();
  ids.add(attackId);
  while (ids.size > MAX_IDS) {
    const first = ids.values().next().value;
    if (!first) break;
    ids.delete(first);
  }
  persist();
}

export function resetFleetSaveDismissals(): void {
  ids.clear();
  loaded = true;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore a store that cannot be cleared.
  }
}
