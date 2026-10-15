/**
 * Resumable scrypt (N=16384, r=8, p=1, 64-byte key) for the Workers free
 * plan. One full verify is ~30 ms of CPU, over the 10 ms cap, so a Durable
 * Object steps the SMix loops and the account is rehashed to PBKDF2 once.
 * The stepper matches Node's scrypt for the same parameters.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const BLOCK = 128 * R;

export interface ScryptJob {
  password: string;
  salt: Uint8Array;
  expected: Uint8Array;
  phase: "fill" | "mix" | "done";
  /** Current SMix block (128*r bytes). */
  x: Uint8Array;
  /** V[0..N) laid out back to back. 16 MB at the production parameters. */
  v: Uint8Array;
  i: number;
  match: boolean | null;
}

function rotl(n: number, b: number): number {
  return ((n << b) | (n >>> (32 - b))) >>> 0;
}

function add32(a: number, b: number): number {
  return (a + b) >>> 0;
}

/** Salsa20/8 on one 64-byte block, in place. */
function salsa20_8(block: Uint8Array): void {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    const o = i * 4;
    x[i] =
      block[o]! |
      (block[o + 1]! << 8) |
      (block[o + 2]! << 16) |
      (block[o + 3]! << 24);
  }
  const z0 = x[0]!;
  const z1 = x[1]!;
  const z2 = x[2]!;
  const z3 = x[3]!;
  const z4 = x[4]!;
  const z5 = x[5]!;
  const z6 = x[6]!;
  const z7 = x[7]!;
  const z8 = x[8]!;
  const z9 = x[9]!;
  const z10 = x[10]!;
  const z11 = x[11]!;
  const z12 = x[12]!;
  const z13 = x[13]!;
  const z14 = x[14]!;
  const z15 = x[15]!;
  for (let round = 0; round < 8; round += 2) {
    x[4] = x[4]! ^ rotl(add32(x[0]!, x[12]!), 7);
    x[8] = x[8]! ^ rotl(add32(x[4]!, x[0]!), 9);
    x[12] = x[12]! ^ rotl(add32(x[8]!, x[4]!), 13);
    x[0] = x[0]! ^ rotl(add32(x[12]!, x[8]!), 18);
    x[9] = x[9]! ^ rotl(add32(x[5]!, x[1]!), 7);
    x[13] = x[13]! ^ rotl(add32(x[9]!, x[5]!), 9);
    x[1] = x[1]! ^ rotl(add32(x[13]!, x[9]!), 13);
    x[5] = x[5]! ^ rotl(add32(x[1]!, x[13]!), 18);
    x[14] = x[14]! ^ rotl(add32(x[10]!, x[6]!), 7);
    x[2] = x[2]! ^ rotl(add32(x[14]!, x[10]!), 9);
    x[6] = x[6]! ^ rotl(add32(x[2]!, x[14]!), 13);
    x[10] = x[10]! ^ rotl(add32(x[6]!, x[2]!), 18);
    x[3] = x[3]! ^ rotl(add32(x[15]!, x[11]!), 7);
    x[7] = x[7]! ^ rotl(add32(x[3]!, x[15]!), 9);
    x[11] = x[11]! ^ rotl(add32(x[7]!, x[3]!), 13);
    x[15] = x[15]! ^ rotl(add32(x[11]!, x[7]!), 18);
    x[1] = x[1]! ^ rotl(add32(x[0]!, x[3]!), 7);
    x[2] = x[2]! ^ rotl(add32(x[1]!, x[0]!), 9);
    x[3] = x[3]! ^ rotl(add32(x[2]!, x[1]!), 13);
    x[0] = x[0]! ^ rotl(add32(x[3]!, x[2]!), 18);
    x[6] = x[6]! ^ rotl(add32(x[5]!, x[4]!), 7);
    x[7] = x[7]! ^ rotl(add32(x[6]!, x[5]!), 9);
    x[4] = x[4]! ^ rotl(add32(x[7]!, x[6]!), 13);
    x[5] = x[5]! ^ rotl(add32(x[4]!, x[7]!), 18);
    x[11] = x[11]! ^ rotl(add32(x[10]!, x[9]!), 7);
    x[8] = x[8]! ^ rotl(add32(x[11]!, x[10]!), 9);
    x[9] = x[9]! ^ rotl(add32(x[8]!, x[11]!), 13);
    x[10] = x[10]! ^ rotl(add32(x[9]!, x[8]!), 18);
    x[12] = x[12]! ^ rotl(add32(x[15]!, x[14]!), 7);
    x[13] = x[13]! ^ rotl(add32(x[12]!, x[15]!), 9);
    x[14] = x[14]! ^ rotl(add32(x[13]!, x[12]!), 13);
    x[15] = x[15]! ^ rotl(add32(x[14]!, x[13]!), 18);
  }
  x[0] = add32(x[0]!, z0);
  x[1] = add32(x[1]!, z1);
  x[2] = add32(x[2]!, z2);
  x[3] = add32(x[3]!, z3);
  x[4] = add32(x[4]!, z4);
  x[5] = add32(x[5]!, z5);
  x[6] = add32(x[6]!, z6);
  x[7] = add32(x[7]!, z7);
  x[8] = add32(x[8]!, z8);
  x[9] = add32(x[9]!, z9);
  x[10] = add32(x[10]!, z10);
  x[11] = add32(x[11]!, z11);
  x[12] = add32(x[12]!, z12);
  x[13] = add32(x[13]!, z13);
  x[14] = add32(x[14]!, z14);
  x[15] = add32(x[15]!, z15);
  for (let i = 0; i < 16; i++) {
    const v = x[i]!;
    const o = i * 4;
    block[o] = v & 0xff;
    block[o + 1] = (v >>> 8) & 0xff;
    block[o + 2] = (v >>> 16) & 0xff;
    block[o + 3] = (v >>> 24) & 0xff;
  }
}

const mixX = new Uint8Array(64);
const mixY = new Uint8Array(BLOCK);

function blockMix(input: Uint8Array, output: Uint8Array): void {
  mixX.set(input.subarray(BLOCK - 64, BLOCK));
  for (let i = 0; i < 2 * R; i++) {
    const bi = i * 64;
    for (let j = 0; j < 64; j++) mixX[j]! ^= input[bi + j]!;
    salsa20_8(mixX);
    mixY.set(mixX, i * 64);
  }
  let offset = 0;
  for (let i = 0; i < 2 * R; i += 2) {
    output.set(mixY.subarray(i * 64, i * 64 + 64), offset);
    offset += 64;
  }
  for (let i = 1; i < 2 * R; i += 2) {
    output.set(mixY.subarray(i * 64, i * 64 + 64), offset);
    offset += 64;
  }
}

function integerify(block: Uint8Array): number {
  const o = BLOCK - 64;
  return (
    block[o]! |
    (block[o + 1]! << 8) |
    (block[o + 2]! << 16) |
    (block[o + 3]! << 24)
  ) >>> 0;
}

function xorBlock(target: Uint8Array, v: Uint8Array, vOffset: number): void {
  for (let i = 0; i < BLOCK; i++) target[i]! ^= v[vOffset + i]!;
}

function b64urlToBytes(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2Once(
  password: string,
  salt: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 1, hash: "SHA-256" },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export function parseScryptEncoded(
  encoded: string,
): { salt: Uint8Array; expected: Uint8Array } | null {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return null;
  const salt = b64urlToBytes(parts[1] ?? "");
  const expected = b64urlToBytes(parts[2] ?? "");
  if (salt.length === 0 || expected.length !== KEY_LEN) return null;
  return { salt, expected };
}

export async function startScryptJob(
  password: string,
  encoded: string,
): Promise<ScryptJob | null> {
  const parsed = parseScryptEncoded(encoded);
  if (!parsed) return null;
  const block = await pbkdf2Once(password, parsed.salt, P * BLOCK);
  return {
    password,
    salt: parsed.salt,
    expected: parsed.expected,
    phase: "fill",
    x: block,
    v: new Uint8Array(N * BLOCK),
    i: 0,
    match: null,
  };
}

/**
 * Run SMix until `budgetMs` elapses or the job finishes.
 * Returns whether this call finished the verify.
 */
export function stepScryptJob(job: ScryptJob, budgetMs: number): boolean {
  if (job.phase === "done") return true;
  const deadline = performance.now() + budgetMs;
  const scratch = new Uint8Array(BLOCK);
  while (performance.now() < deadline) {
    if (job.phase === "fill") {
      const off = job.i * BLOCK;
      job.v.set(job.x, off);
      blockMix(job.x, scratch);
      job.x.set(scratch);
      job.i += 1;
      if (job.i >= N) {
        job.phase = "mix";
        job.i = 0;
      }
      continue;
    }
    if (job.phase === "mix") {
      const j = integerify(job.x) & (N - 1);
      xorBlock(job.x, job.v, j * BLOCK);
      blockMix(job.x, scratch);
      job.x.set(scratch);
      job.i += 1;
      if (job.i >= N) {
        job.phase = "done";
        break;
      }
      continue;
    }
    break;
  }
  return job.phase === "done";
}

/** Final PBKDF2. Call only after `stepScryptJob` reports done. */
export async function finishScryptJob(job: ScryptJob): Promise<boolean> {
  if (job.phase !== "done") return false;
  if (job.match != null) return job.match;
  const derived = await pbkdf2Once(job.password, job.x, KEY_LEN);
  let diff = 0;
  for (let i = 0; i < KEY_LEN; i++) diff |= derived[i]! ^ job.expected[i]!;
  job.match = diff === 0;
  job.password = "";
  return job.match;
}

/** Test helper: parameters the production hashes use. */
export const SCRYPT_STEP_PARAMS = { N, r: R, p: P, keyLen: KEY_LEN } as const;
