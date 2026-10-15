import { escapeAttr } from "./render-escape";

/** Circular planet disc. Lists lazy-load; the overview hero does not. */
export function planetDiscHtml(opts: {
  src: string;
  artId: string;
  size: number;
  className?: string;
  testId?: string;
  lazy?: boolean;
}): string {
  const loading = opts.lazy === false ? "eager" : "lazy";
  const cls = ["thumb", "planet-disc", opts.className ?? ""]
    .filter((part) => part.length > 0)
    .join(" ");
  const testId = opts.testId
    ? ` data-testid="${escapeAttr(opts.testId)}"`
    : "";
  return `<img class="${cls}" src="${escapeAttr(opts.src)}" alt="" width="${opts.size}" height="${opts.size}" loading="${loading}" decoding="async"${testId} data-art-id="${escapeAttr(opts.artId)}" />`;
}
