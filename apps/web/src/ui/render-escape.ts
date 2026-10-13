/** HTML / attribute escaping shared by render modules. */
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replaceAll("'", "&#39;");
}
