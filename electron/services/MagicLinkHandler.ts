/**
 * Magic-link deep-link handler — Electron integration layer.
 *
 * The Glassnote backend redirects a verified magic-link click to:
 *   glassnote://auth?key=<plaintext_api_key>&email=<user_email>
 *
 * This module owns the Electron-aware bits:
 *   - Registering "glassnote://" as the OS-level handler for this app
 *   - Storing the API key via CredentialsManager
 *   - Surfacing a one-line success/failure log + an optional UI hook
 *
 * Pure URL parsing lives in `MagicLinkParser.ts` (no electron imports) so it
 * can be unit-tested without an Electron runtime. The legacy names are
 * re-exported here for callers that already import them from this module.
 *
 * Security notes:
 *   - We do NOT log the plaintext key. Only the first 16 chars (the
 *     non-secret prefix) go to console.
 *   - We reject keys that don't match the expected prefix shape — see
 *     MagicLinkParser.parseMagicLinkUrl for the validation rules.
 *   - Email is stored only if the call site provides a hook; this module
 *     does NOT cache the email itself (keeps the surface area small).
 */
import { app } from "electron";
import { CredentialsManager } from "./CredentialsManager";
import {
  parseMagicLinkUrl,
  obscureKey,
  findMagicLinkInArgv,
  MAGIC_LINK_PROTOCOL,
} from "./MagicLinkParser";

// Re-export so existing call sites (electron/main.ts) keep working without
// having to know about the file split.
export { parseMagicLinkUrl, findMagicLinkInArgv } from "./MagicLinkParser";
export type { ParsedMagicLink } from "./MagicLinkParser";

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
      `[MagicLink] stored key (prefix=${obscureKey(parsed.key)}, email=${parsed.email ?? "—"})`,
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
      app.setAsDefaultProtocolClient(MAGIC_LINK_PROTOCOL, process.execPath, [
        require("path").resolve(process.argv[1]!),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(MAGIC_LINK_PROTOCOL);
  }
}
