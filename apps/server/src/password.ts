/**
 * WebCrypto PBKDF2-SHA-256 for the Workers free plan.
 * 10,000 iterations is about 2 ms on Node. OWASP's 600,000 does not fit
 * inside a 10 ms CPU budget, so Workers hashes are intentionally weaker
 * than the Vercel scrypt hashes. Vercel keeps scrypt as the primary hash
 * and stamps a PBKDF2 copy on login so a later KV export can sign in here.
 */

import { addCpu } from "./request-context.js";

export const PBKDF2_ITERATIONS = 10_000;
const PBKDF2_BITS = 256;
const SALT_BYTES = 16;
/** Reject hostile iteration counts written into D1. */
const PBKDF2_MAX_ITERATIONS = 20_000;

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlToBytes(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashPbkdf2(
  pepperedPassword: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const derived = await derivePbkdf2(pepperedPassword, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToB64url(salt)}$${bytesToB64url(derived)}`;
}

export async function verifyPbkdf2(
  pepperedPassword: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > PBKDF2_MAX_ITERATIONS
  ) {
    return false;
  }
  const salt = b64urlToBytes(parts[2] ?? "");
  const expected = b64urlToBytes(parts[3] ?? "");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await derivePbkdf2(pepperedPassword, salt, iterations);
  return timingSafeEqualBytes(derived, expected);
}

async function derivePbkdf2(
  pepperedPassword: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const started = performance.now();
  try {
    return await derivePbkdf2Now(pepperedPassword, salt, iterations);
  } finally {
    addCpu(performance.now() - started);
  }
}

async function derivePbkdf2Now(
  pepperedPassword: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepperedPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    key,
    PBKDF2_BITS,
  );
  return new Uint8Array(bits);
}
