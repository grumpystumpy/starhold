/**
 * Update a live subtree from HTML without replacing focused controls
 * or resetting window scroll. Same-shaped trees are patched in place.
 */

const QUANTITY_SELECTOR = [
  "[data-ship-count]",
  "[data-defense-count]",
  "[data-fleet-count]",
  "[data-cargo-metal]",
  "[data-cargo-crystal]",
  "[data-cargo-deuterium]",
].join(",");

function isFormControl(
  el: Element,
): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function keepValue(el: Element): boolean {
  if (document.activeElement === el) return true;
  if (el instanceof HTMLElement && el.dataset.userEdited === "1") return true;
  if (el.matches(QUANTITY_SELECTOR)) return true;
  return false;
}

function containsFocus(el: Node): boolean {
  const active = document.activeElement;
  return active != null && el instanceof Element && el.contains(active);
}

function nodeKey(el: Element): string | null {
  const testId = el.getAttribute("data-testid");
  if (
    testId &&
    testId !== "cost-tip" &&
    testId !== "info-tip" &&
    testId !== "message-kind"
  ) {
    return `t:${testId}`;
  }
  if (el.id) return `i:${el.id}`;
  return null;
}

function skipAttr(current: Element, name: string): boolean {
  if (name === "value" || name === "checked" || name === "selected") {
    return keepValue(current);
  }
  if (name === "disabled") return document.activeElement === current;
  return false;
}

function syncAttributes(current: Element, next: Element): void {
  const nextNames = next.getAttributeNames();
  const nextSet = new Set(nextNames);
  for (const name of current.getAttributeNames()) {
    if (nextSet.has(name)) continue;
    if (name === "open" && current.tagName === "DETAILS") continue;
    if (skipAttr(current, name)) continue;
    current.removeAttribute(name);
  }
  for (const name of nextNames) {
    if (skipAttr(current, name)) continue;
    const value = next.getAttribute(name);
    if (value != null && current.getAttribute(name) !== value) {
      current.setAttribute(name, value);
    }
  }
  if (keepValue(current) || !isFormControl(current) || !isFormControl(next)) return;
  if (current instanceof HTMLSelectElement && next instanceof HTMLSelectElement) {
    if (current.value !== next.value) current.value = next.value;
    return;
  }
  if (
    current instanceof HTMLInputElement &&
    next instanceof HTMLInputElement &&
    (current.type === "checkbox" || current.type === "radio")
  ) {
    if (current.checked !== next.checked) current.checked = next.checked;
    return;
  }
  if ("value" in current && "value" in next && current.value !== next.value) {
    current.value = next.value;
  }
}

function sameShape(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  if (!(a instanceof Element) || !(b instanceof Element)) return false;
  if (a.tagName !== b.tagName) return false;
  if (a.childNodes.length !== b.childNodes.length) return false;
  for (let i = 0; i < a.childNodes.length; i++) {
    if (!sameShape(a.childNodes[i]!, b.childNodes[i]!)) return false;
  }
  return true;
}

function patchInPlace(current: Node, next: Node): void {
  if (current.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
    if (current.textContent !== next.textContent) {
      current.textContent = next.textContent;
    }
    return;
  }
  if (!(current instanceof Element) || !(next instanceof Element)) return;
  syncAttributes(current, next);
  const count = current.childNodes.length;
  for (let i = 0; i < count; i++) {
    patchInPlace(current.childNodes[i]!, next.childNodes[i]!);
  }
}

function morphChildren(parent: Element, nextParent: Element): void {
  const nextChildren = [...nextParent.childNodes];
  const keyed = new Map<string, Element>();
  for (const child of parent.children) {
    const key = nodeKey(child);
    if (key && !keyed.has(key)) keyed.set(key, child);
  }

  let cursor: ChildNode | null = parent.firstChild;
  for (const next of nextChildren) {
    if (next instanceof Element) {
      const key = nodeKey(next);
      const match = key ? keyed.get(key) : undefined;
      if (match && match.tagName === next.tagName) {
        if (key) keyed.delete(key);
        if (sameShape(match, next)) patchInPlace(match, next);
        else morphElement(match, next);
        if (match !== cursor) parent.insertBefore(match, cursor);
        cursor = match.nextSibling;
        continue;
      }
      const created = next.cloneNode(true);
      parent.insertBefore(created, cursor);
      continue;
    }
    if (
      cursor &&
      cursor.nodeType === Node.TEXT_NODE &&
      next.nodeType === Node.TEXT_NODE
    ) {
      if (cursor.textContent !== next.textContent) {
        cursor.textContent = next.textContent;
      }
      cursor = cursor.nextSibling;
      continue;
    }
    parent.insertBefore(document.createTextNode(next.textContent ?? ""), cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    if (containsFocus(cursor)) {
      cursor = next;
      continue;
    }
    cursor.remove();
    cursor = next;
  }
}

function morphElement(current: Element, next: Element): void {
  if (current.tagName !== next.tagName) {
    if (containsFocus(current)) return;
    current.replaceWith(next.cloneNode(true));
    return;
  }
  syncAttributes(current, next);
  morphChildren(current, next);
}

function focusSelector(el: Element): string | null {
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  return null;
}

/** Replace `host`'s children from an HTML string without dropping focus or scroll. */
export function morphHtml(host: Element, html: string): void {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  const selector =
    active instanceof Element && host.contains(active) ? focusSelector(active) : null;
  let value: string | null = null;
  let selStart: number | null = null;
  let selEnd: number | null = null;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement
  ) {
    value = active.value;
    try {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    } catch {
      selStart = null;
      selEnd = null;
    }
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const staging = document.createElement("div");
  staging.append(...template.content.childNodes);

  if (
    host.childNodes.length === staging.childNodes.length &&
    [...host.childNodes].every((node, i) => sameShape(node, staging.childNodes[i]!))
  ) {
    const count = host.childNodes.length;
    for (let i = 0; i < count; i++) {
      patchInPlace(host.childNodes[i]!, staging.childNodes[i]!);
    }
  } else {
    morphChildren(host, staging);
  }

  if (selector) {
    const again = host.querySelector(selector);
    if (again instanceof HTMLElement && document.activeElement !== again) {
      again.focus({ preventScroll: true });
    }
    if (
      value != null &&
      (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)
    ) {
      if (again.value !== value) again.value = value;
      if (selStart != null && selEnd != null) {
        try {
          again.setSelectionRange(selStart, selEnd);
        } catch {
          /* number inputs */
        }
      }
    }
  }
  if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
    window.scrollTo(scrollX, scrollY);
  }
}
