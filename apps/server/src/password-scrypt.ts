/**
 * Node scrypt for Vercel and local accounts.
 * Imported as a namespace so a Workers runtime without `scrypt` can still
 * load this module; hashing is refused there before these functions run.
 */

import * as nodeCrypto from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

type ScryptFn = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
  callback: (err: Error | null, derived: Buffer) => void,
) => void;

function scryptFn(): ScryptFn {
  const fn = (nodeCrypto as { scrypt?: ScryptFn }).scrypt;
  if (typeof fn !== "function") {
    throw new Error("scrypt is not available on this runtime.");
  }
  return fn;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptFn()(
      password,
      salt,
      keylen,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      },
    );
  });
}

export async function hashScrypt(pepperedPassword: string): Promise<string> {
  const salt = nodeCrypto.randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(pepperedPassword, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyScrypt(
  pepperedPassword: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1] ?? "", "base64url");
  const expected = Buffer.from(parts[2] ?? "", "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scryptAsync(pepperedPassword, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return nodeCrypto.timingSafeEqual(derived, expected);
}
