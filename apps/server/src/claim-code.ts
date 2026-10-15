/**
 * One-time password claim codes for imported accounts.
 * The plaintext is emailed or written to a local file. D1 stores only a hash.
 */
import { createHash, randomBytes } from "node:crypto";

/** Unambiguous alphabet. 8 chars is 40 bits; 32 symbols so a byte modulo is unbiased. */
export const CLAIM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CLAIM_CODE_LENGTH = 8;
/** Emailed codes. The player is at the screen when it is sent. */
export const CLAIM_CODE_TTL_MS = 30 * 60 * 1000;
export const CLAIM_CODE_TTL_SEC = CLAIM_CODE_TTL_MS / 1000;
/** Codes written to claim-codes.txt. Micah hands these out by hand. */
export const IMPORT_CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const CLAIM_MAIL_MESSAGE =
  "If that account needs a new password, a claim code was sent. It expires in 30 minutes and works once.";
export const CLAIM_NO_MAIL_MESSAGE =
  "Email isn't set up. Enter the claim code you were given. It lasts 7 days and works once.";

export interface ClaimCodeRecord {
  accountId: string;
  codeHash: string;
  expiresAt: number;
}

export interface ImportClaimCode {
  accountId: string;
  email: string;
  code: string;
  expiresAt: number;
  record: ClaimCodeRecord;
}

export function claimMailConfigured(): boolean {
  return Boolean(process.env.CLAIM_MAIL_URL?.trim());
}

export function claimCodeKey(accountId: string): string {
  return `starhold:claim-code:${accountId}`;
}

export function normalizeClaimCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isValidClaimCode(code: string): boolean {
  if (code.length < 6 || code.length > 8) return false;
  for (const ch of code) {
    if (!CLAIM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function newClaimCode(): string {
  const bytes = randomBytes(CLAIM_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) {
    out += CLAIM_CODE_ALPHABET[bytes[i]! % CLAIM_CODE_ALPHABET.length];
  }
  return out;
}

/** SHA-256 of `secret:code`. The secret is the Workers SESSION_SECRET. */
export function hashClaimCode(code: string, secret: string): string {
  return createHash("sha256")
    .update(`${secret}:${normalizeClaimCode(code)}`)
    .digest("hex");
}

export function buildImportClaimCodes(
  accounts: { id: string; email: string }[],
  secret: string,
  now: number,
): ImportClaimCode[] {
  return accounts.map((account) => {
    const code = newClaimCode();
    const expiresAt = now + IMPORT_CLAIM_CODE_TTL_MS;
    return {
      accountId: account.id,
      email: account.email,
      code,
      expiresAt,
      record: {
        accountId: account.id,
        codeHash: hashClaimCode(code, secret),
        expiresAt,
      },
    };
  });
}

export function formatClaimCodeFile(codes: ImportClaimCode[], now: number): string {
  const lines = [
    "# Starhold one-time claim codes. Hand these out privately.",
    "# Each code works once and expires 7 days after this file was written.",
    "# Do not commit this file.",
    `# written ${new Date(now).toISOString()}`,
    "email\tcode\texpires",
    ...codes.map(
      (row) =>
        `${row.email}\t${row.code}\t${new Date(row.expiresAt).toISOString()}`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** POST { email, code } to CLAIM_MAIL_URL. Returns false when unset or the POST fails. */
export async function sendClaimCode(email: string, code: string): Promise<boolean> {
  const url = process.env.CLAIM_MAIL_URL?.trim();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        code,
        expiresInMinutes: 30,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error(
      "[starhold-auth] claim mail failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
