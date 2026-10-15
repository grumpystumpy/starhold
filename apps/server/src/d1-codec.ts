/** D1 cell limit is ~100 KB per SQL value. Stay under that with room for the query. */
export const D1_CHUNK_CHARS = 48_000;
export const D1_CHUNK_PREFIX = "starhold-chunks:v1:";

export interface ChunkedText {
  manifest: string;
  parts: string[];
}

/** `null` when `text` fits in one row. */
export function splitChunkText(text: string): ChunkedText | null {
  if (text.length <= D1_CHUNK_CHARS) return null;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += D1_CHUNK_CHARS) {
    parts.push(text.slice(i, i + D1_CHUNK_CHARS));
  }
  return { manifest: `${D1_CHUNK_PREFIX}${parts.length}`, parts };
}

/** Part count stored in a manifest row, or null when the value is plain JSON. */
export function chunkPartCount(manifest: string): number | null {
  if (!manifest.startsWith(D1_CHUNK_PREFIX)) return null;
  const n = Number(manifest.slice(D1_CHUNK_PREFIX.length));
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function chunkKey(key: string, index: number): string {
  return `${key}#${index}`;
}
