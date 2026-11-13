/**
 * Minimal DOM so tooltip tap tests can load session.ts without the shared
 * test-dom stub. Import this module before session or the pointer handlers.
 */

type Attrs = Map<string, string>;

class TipElement {
  attrs: Attrs = new Map();
  children: TipElement[] = [];
  parent: TipElement | null = null;
  classNames = new Set<string>();
  style: Record<string, string> = {};
  offsetWidth = 180;
  listeners: Array<{
    type: string;
    fn: EventListener;
    capture: boolean;
  }> = [];

  constructor(public tag = "div") {}

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) ?? "") : null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  get classList(): {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    contains: (name: string) => boolean;
  } {
    const names = this.classNames;
    return {
      add(...extra: string[]) {
        for (const name of extra) names.add(name);
      },
      remove(...extra: string[]) {
        for (const name of extra) names.delete(name);
      },
      contains(name: string) {
        return names.has(name);
      },
    };
  }

  append(child: TipElement): void {
    child.parent = this;
    this.children.push(child);
  }

  matches(selector: string): boolean {
    return selector.split(",").some((part) => matchesOne(this, part.trim()));
  }

  closest(selector: string): TipElement | null {
    let node: TipElement | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  querySelector(selector: string): TipElement | null {
    if (selector === ".tip-bubble") {
      return this.children.find((child) => child.classNames.has("tip-bubble")) ?? null;
    }
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TipElement[] {
    const found: TipElement[] = [];
    const walk = (node: TipElement): void => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  getBoundingClientRect(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  } {
    return { left: 12, right: 32, top: 8, bottom: 28, width: 20, height: 20 };
  }

  contains(node: TipElement): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  addEventListener(type: string, fn: EventListener, capture = false): void {
    this.listeners.push({ type, fn, capture });
  }
}

function matchesOne(el: TipElement, selector: string): boolean {
  if (selector.startsWith(".") && !selector.includes("[")) {
    return el.classNames.has(selector.slice(1));
  }
  const className = selector.match(/\.([a-z0-9-]+)/i)?.[1];
  if (className && !el.classNames.has(className)) return false;
  const attrs: Array<{ name: string; value?: string }> = [];
  const re = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(selector))) {
    attrs.push({ name: match[1] ?? "", value: match[2] });
  }
  if (attrs.length === 0) return false;
  return attrs.every((attr) => {
    if (!el.attrs.has(attr.name)) return false;
    if (attr.value === undefined) return true;
    return el.attrs.get(attr.name) === attr.value;
  });
}

const app = new TipElement("div");
app.setAttribute("id", "app");

const documentStub = {
  documentElement: new TipElement("html"),
  querySelector(sel: string) {
    return sel === "#app" ? app : null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  createElement() {
    return new TipElement("div");
  },
};

const windowStub = {
  innerWidth: 390,
  addEventListener() {},
  setTimeout: (fn: TimerHandler, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
};

const globals = globalThis as unknown as {
  HTMLElement: typeof TipElement;
  Element: typeof TipElement;
  document: Document;
  window: typeof windowStub;
  getComputedStyle: (el: unknown) => { fontSize: string };
  requestAnimationFrame: (fn: () => void) => number;
};
globals.HTMLElement = TipElement;
globals.Element = TipElement;
globals.document = documentStub as unknown as Document;
globals.window = windowStub;
globals.getComputedStyle = () => ({ fontSize: "16px" });
globals.requestAnimationFrame = (fn) => {
  fn();
  return 1;
};

export { TipElement, app };
