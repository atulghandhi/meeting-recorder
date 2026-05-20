// Tests run against the esbuild-compiled MagicLinkParser in dist-electron/.
// Run via: npm test (which builds first then runs `node --test`).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/MagicLinkParser.js',
);
const { parseMagicLinkUrl, findMagicLinkInArgv, obscureKey } = await import(
  pathToFileURL(compiledPath).href
);

// Realistic key: 13-char prefix + 43 base64url chars (32 bytes of entropy)
const VALID_KEY = 'glassnote_sk_' + 'A'.repeat(43);

describe('parseMagicLinkUrl', () => {
  test('parses a well-formed URL with key + email', () => {
    const url = `glassnote://auth?key=${VALID_KEY}&email=${encodeURIComponent('user@example.com')}`;
    const out = parseMagicLinkUrl(url);
    assert.ok(out, 'expected non-null parse result');
    assert.equal(out.key, VALID_KEY);
    assert.equal(out.email, 'user@example.com');
  });

  test('parses URL without email (email = null)', () => {
    const url = `glassnote://auth?key=${VALID_KEY}`;
    const out = parseMagicLinkUrl(url);
    assert.ok(out);
    assert.equal(out.key, VALID_KEY);
    assert.equal(out.email, null);
  });

  test('accepts URLs without `auth` hostname (just glassnote://?key=...)', () => {
    const url = `glassnote://?key=${VALID_KEY}`;
    const out = parseMagicLinkUrl(url);
    assert.ok(out);
    assert.equal(out.key, VALID_KEY);
  });

  test('rejects URL with wrong protocol', () => {
    const url = `https://auth?key=${VALID_KEY}`;
    assert.equal(parseMagicLinkUrl(url), null);
  });

  test('rejects URL with no key param', () => {
    const url = 'glassnote://auth?other=value';
    assert.equal(parseMagicLinkUrl(url), null);
  });

  test('rejects URL with wrong key prefix (defends against crafted URLs)', () => {
    // An attacker could craft a glassnote:// URL with a non-API-key payload.
    // The prefix check rejects it before CredentialsManager ever sees it.
    const url = 'glassnote://auth?key=evil_payload_with_50_padding_characters_x';
    assert.equal(parseMagicLinkUrl(url), null);
  });

  test('rejects key that is too short (truncated in transit)', () => {
    const url = 'glassnote://auth?key=glassnote_sk_short';
    assert.equal(parseMagicLinkUrl(url), null);
  });

  test('rejects key that is too long (suspicious / not our format)', () => {
    const url = `glassnote://auth?key=glassnote_sk_${'A'.repeat(200)}`;
    assert.equal(parseMagicLinkUrl(url), null);
  });

  test('rejects malformed URL string (no throw)', () => {
    assert.equal(parseMagicLinkUrl('not-a-url-at-all'), null);
    assert.equal(parseMagicLinkUrl('glassnote://[invalid bracket'), null);
  });

  test('rejects non-string input (no throw)', () => {
    assert.equal(parseMagicLinkUrl(null), null);
    assert.equal(parseMagicLinkUrl(undefined), null);
    assert.equal(parseMagicLinkUrl(42), null);
    assert.equal(parseMagicLinkUrl({}), null);
  });

  test('rejects empty string', () => {
    assert.equal(parseMagicLinkUrl(''), null);
  });

  test('preserves email exactly as URL-decoded (does not lowercase or normalize)', () => {
    // The server's verify route already lowercases on read; the client should
    // pass through whatever the URL says without surprises.
    const url = `glassnote://auth?key=${VALID_KEY}&email=${encodeURIComponent('User+Tag@Example.COM')}`;
    const out = parseMagicLinkUrl(url);
    assert.equal(out.email, 'User+Tag@Example.COM');
  });

  test('accepts realistic key lengths (32 bytes base64url after prefix)', () => {
    // Server's generateApiKey: randomBytes(32).toString('base64url') → 43 chars.
    // Total: 13 prefix + 43 entropy = 56 chars. Build one programmatically so
    // the test doesn't drift if I miscount keystrokes (lesson learned).
    const entropy = 'a'.repeat(43); // exactly 43 chars — the production length
    const realisticKey = `glassnote_sk_${entropy}`;
    assert.equal(realisticKey.length, 56);
    const url = `glassnote://auth?key=${realisticKey}`;
    const out = parseMagicLinkUrl(url);
    assert.ok(out);
    assert.equal(out.key, realisticKey);
  });
});

describe('findMagicLinkInArgv', () => {
  test('finds the URL in a mixed argv array', () => {
    const argv = ['/path/to/electron', '/path/to/app.js', `glassnote://auth?key=${VALID_KEY}`, '--some-flag'];
    assert.equal(findMagicLinkInArgv(argv), `glassnote://auth?key=${VALID_KEY}`);
  });

  test('returns null when no glassnote URL present', () => {
    const argv = ['/path/to/electron', '/path/to/app.js', '--flag', 'value'];
    assert.equal(findMagicLinkInArgv(argv), null);
  });

  test('returns null for empty argv', () => {
    assert.equal(findMagicLinkInArgv([]), null);
  });

  test('returns the FIRST glassnote URL when multiple present (deterministic)', () => {
    const first = `glassnote://auth?key=${VALID_KEY}`;
    const second = `glassnote://auth?key=glassnote_sk_${'B'.repeat(43)}`;
    assert.equal(findMagicLinkInArgv([first, second]), first);
  });

  test('ignores non-string items defensively (no throw)', () => {
    // Real argv is always strings, but be paranoid — caller might pass any[]
    const argv = [123, null, undefined, `glassnote://auth?key=${VALID_KEY}`];
    assert.equal(findMagicLinkInArgv(argv), `glassnote://auth?key=${VALID_KEY}`);
  });
});

describe('obscureKey', () => {
  test('keeps first 16 chars + ellipsis for normal-length keys', () => {
    const out = obscureKey(VALID_KEY);
    assert.equal(out, 'glassnote_sk_AAA…');
  });

  test('returns *** for very short input (no useful prefix to show)', () => {
    assert.equal(obscureKey('short'), '***');
    assert.equal(obscureKey(''), '***');
  });

  test('exactly 16 chars also returns *** (boundary)', () => {
    assert.equal(obscureKey('1234567890123456'), '***');
  });

  test('17 chars uses the prefix branch', () => {
    assert.equal(obscureKey('12345678901234567'), '1234567890123456…');
  });
});
