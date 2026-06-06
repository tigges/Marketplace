import { newToken } from "./ids.js";

/**
 * API key handling for registered agents.
 *
 * We never store the raw key. A key is `ab_<env>_<token>`; we persist a
 * SHA-256 hash plus a short, non-secret prefix used for display and fast
 * lookup. Hashing uses Web Crypto (`crypto.subtle`) so the exact same code
 * runs in Node, Vercel, and Cloudflare Workers.
 */

export interface GeneratedApiKey {
  /** The full secret — shown to the user exactly once. */
  plaintext: string;
  /** Non-secret prefix stored alongside the hash, e.g. `ab_live_a1b2c3d4`. */
  displayPrefix: string;
  /** Hex SHA-256 of the full secret. */
  hash: string;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashApiKey(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export async function generateApiKey(env: "live" | "test" = "live"): Promise<GeneratedApiKey> {
  const token = newToken(40);
  const plaintext = `ab_${env}_${token}`;
  const hash = await hashApiKey(plaintext);
  const displayPrefix = plaintext.slice(0, 16);
  return { plaintext, displayPrefix, hash };
}

/** Constant-time-ish comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
