/**
 * Pure helpers for the glassnote:// deep-link flow.
 *
 * Lives in its own file (no `electron` imports) so it can be unit-tested
 * via the same .test.mjs pattern used elsewhere in this repo. The
 * Electron-aware orchestration (protocol registration, credential write,
 * window focus) stays in MagicLinkHandler.ts.
 */

const PROTOCOL = "glassnote";
const KEY_PREFIX = "glassnote_sk_";

export interface ParsedMagicLink {
  key: string;
  email: string | null;
}

/**
 * Parse `glassnote://auth?key=...&email=...` URLs.
 *
 * Returns null for anything that doesn't carry a key with the expected
 * prefix and length. Defends against:
 *   - A malicious site sending a crafted glassnote:// URL with a non-key
 *     payload (returns null → handler logs + skips, never reaches Credentials).
 *   - Truncated keys from URL mishandling (length check).
 *   - URLs from other protocols (prefix check).
 */
export function parseMagicLinkUrl(url: string): ParsedMagicLink | null {
  if (typeof url !== "string" || !url.startsWith(`${PROTOCOL}://`)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Path conventions we accept: glassnote://auth?... and glassnote://?...
  // (hostname varies across platforms; just require a `key` query param).
  const key = parsed.searchParams.get("key");
  if (!key || !key.startsWith(KEY_PREFIX)) return null;
  // 32 bytes of base64url = 43 chars; total = 13 prefix + 43 = 56.
  // Accept a small range to tolerate base64url padding edge cases.
  if (key.length < 40 || key.length > 80) return null;
  const email = parsed.searchParams.get("email") ?? null;
  return { key, email };
}

/**
 * Format the non-secret 16-char prefix used in logs.
 *
 * `glassnote_sk_AbCdEfGh...` → `glassnote_sk_AbC…`. Always safe to log.
 */
export function obscureKey(key: string): string {
  return key.length <= 16 ? "***" : `${key.slice(0, 16)}…`;
}

/**
 * Scan a CLI argv (process.argv or second-instance argv) for a glassnote:// URL.
 * Used on Windows + Linux where the URL arrives as a command-line argument
 * rather than via the open-url event.
 */
export function findMagicLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(`${PROTOCOL}://`)) return arg;
  }
  return null;
}

export const MAGIC_LINK_PROTOCOL = PROTOCOL;
export const MAGIC_LINK_KEY_PREFIX = KEY_PREFIX;
