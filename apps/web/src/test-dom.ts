/** Minimal document/window so session.ts can load under node:test. */
const app = {
  innerHTML: "",
  querySelector: () => null,
  prepend() {},
};
const win = {
  setTimeout: (fn: TimerHandler, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
};
(globalThis as { window: typeof win }).window = win;
(globalThis as { document: Document }).document = {
  querySelector: (sel: string) => (sel === "#app" ? app : null),
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => app,
  documentElement: app,
} as unknown as Document;
