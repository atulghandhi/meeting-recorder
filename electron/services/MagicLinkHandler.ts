/**
 * Magic-link deep-link handler.
 *
 * The Glassnote backend redirects a verified magic-link click to:
 *   glassnote://auth?key=<plaintext_api_key>&email=<user_email>
 *
 * This module owns:
 *   - Registering "glassnote://" as the OS-level handler for this app
 *   - Parsing inbound URLs from any of the three Electron launch paths
 *     (macOS open-url event, Windows/Linux cold start via process.argv,
 *     Windows/Linux warm via second-instance argv)
 *   - Storing the API key via CredentialsManager
 *   - Surfacing a one-line success/failure log + an optional UI hook
 *
 * Security notes:
 *   - We do NOT log the plaintext key. Only the first 16 chars (the
 *     non-secret prefix, e.g. "glassnote_sk_AbC") go to console.
 *   - We reject keys that don't match the expected prefix shape — defends
 *     against a malicious site sending a crafted glassnote:// URL with a
 *     non-API-key payload that some future bug might mishandle.
 *   - Email is stored only if the call site provides a hook; this module
 *     does NOT cache the email itself (keeps the surface area small).
 */
import { app } from "electron";
import { CredentialsManager } from "./CredentialsManager";

const PROTOCOL = "glassnote";
const KEY_PREFIX = "glassnote_sk_";

export interface ParsedMagicLink {
  key: string;
  email: string | null;
}

/** Pure parser — exported separately so it can be unit-tested. */
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
  // 32 bytes of base64url = 43 chars; total = 13 prefix + 43 = 56
  if (key.length < 40 || key.length > 80) return null;
  const email = parsed.searchParams.get("email") ?? null;
  return { key, email };
}

/** Format the non-secret prefix used in logs. */
function obscure(key: string): string {
  return key.length <= 16 ? "***" : `${key.slice(0, 16)}…`;
}

export interface MagicLinkContext {
  /** Called after a successful credential write — typically focuses the window. */
  onSuccess?: (email: string | null) => void;
  /** Called on parse failure or store failure with a short reason. */
  onFailure?: (reason: string) => void;
}

/**
 * Parses + applies the URL. Returns true if the credential was stored.
 * Safe to call multiple times — the latest URL wins.
 */
export function handleMagicLinkUrl(url: string, ctx?: MagicLinkContext): boolean {
  const parsed = parseMagicLinkUrl(url);
  if (!parsed) {
    console.warn("[MagicLink] rejected URL (does not match expected shape)");
    ctx?.onFailure?.("invalid_url");
    return false;
  }
  try {
    CredentialsManager.getInstance().setGlassnoteApiKey(parsed.key);
    console.log(
      `[MagicLink] stored key (prefix=${obscure(parsed.key)}, email=${parsed.email ?? "—"})`,
    );
    ctx?.onSuccess?.(parsed.email);
    return true;
  } catch (err) {
    console.error("[MagicLink] CredentialsManager.setGlassnoteApiKey threw:", err);
    ctx?.onFailure?.("store_failed");
    return false;
  }
}

/**
 * Register glassnote:// as this app's protocol handler. Idempotent across calls.
 *
 * Must run before app.requestSingleInstanceLock() so that on Windows the OS
 * passes the URL through to the existing instance via the second-instance
 * argv (otherwise Windows spawns a duplicate process which then exits because
 * it can't get the lock, and the URL is lost).
 */
export function registerMagicLinkProtocol(): void {
  if (process.defaultApp) {
    // In dev (`electron .`) we have to tell Electron how to relaunch itself
    // with the protocol arg. In production the installer registers this.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        require("path").resolve(process.argv[1]!),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
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
