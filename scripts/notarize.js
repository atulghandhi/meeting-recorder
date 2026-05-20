/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * electron-builder `afterSign` hook — Apple notarization.
 *
 * Submits the signed .app bundle to Apple's notary service (notarytool) and
 * staples the resulting ticket so the app opens cleanly on a fresh macOS
 * without quarantine warnings.
 *
 * Required env vars (set ONLY when you actually want to notarize):
 *   APPLE_ID                    — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — generated at https://appleid.apple.com/account/manage
 *   APPLE_TEAM_ID               — 10-char alphanumeric, found in Apple Developer portal
 *
 * Behavior matrix:
 *   - Non-macOS build       → skip silently (electron-builder runs hooks
 *                             cross-platform; we have nothing to do on win/linux).
 *   - No CSC_LINK signing   → skip with a one-line warning. Unsigned builds
 *                             can't be notarized.
 *   - Missing APPLE_* vars  → skip with a one-line warning. Allows local dev
 *                             builds to complete without errors.
 *   - All env vars present  → submit + staple. Takes 30s–5min depending on
 *                             Apple's queue.
 *
 * Errors during the submission itself fail the build (we don't want to ship
 * a half-notarized binary).
 */

const path = require("path");
const { promises: fs } = require("fs");

module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      "[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — skipping notarization.\n" +
        "          Local/ad-hoc builds will run unsigned; that's fine for dev.\n" +
        "          Set all three env vars on the release build machine to notarize.",
    );
    return;
  }

  // electron-builder's afterSign hook gives us the app dir; the .app bundle
  // sits inside it. productName comes from the build config.
  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${productName}.app`);

  try {
    await fs.access(appPath);
  } catch {
    console.warn(`[notarize] expected .app at ${appPath} — skipping`);
    return;
  }

  // Lazy require so this script doesn't crash at module-load on machines
  // that haven't installed @electron/notarize yet (e.g. CI matrix runners
  // that build for Windows/Linux only).
  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch (err) {
    console.error(
      "[notarize] @electron/notarize is not installed. Run:\n" +
        "          npm install --save-dev @electron/notarize",
    );
    throw err;
  }

  console.log(`[notarize] submitting ${appPath} to Apple notary service…`);
  const startMs = Date.now();

  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
    // tool: "notarytool" is the default since @electron/notarize v2.
    // altool (legacy) is deprecated by Apple and removed Nov 2023.
  });

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[notarize] ✓ stapled (${elapsedSec}s)`);
};
