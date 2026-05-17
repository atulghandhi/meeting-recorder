# Fork TODO

Running task list for the rebrand-and-sell project. Items are written so an AI coding agent (or a human) can pick one and execute without re-reading the full chat history. Each item: **What / Where / Acceptance criteria**.

Sections are ordered by gating relationship — don't ship the rebrand before security; don't build features before backend.

Linked docs:
- [LATENCY.md](LATENCY.md) — speed plan
- [UI_UX.md](UI_UX.md) — restyle plan
- [BACKEND.md](BACKEND.md) — backend implementation plan (decisions locked, Week 1 built)

---

## 🟡 Your turn — blocks further BE progress

These are things only you can do. Until they're done, the agent can keep writing code but cannot deploy or end-to-end test.

1. **Initialize the BE repo as private.** It's at `../glassnote-api/` (sibling to this dir).
   ```bash
   cd ../glassnote-api && git init && gh repo create glassnote-api --private --source=. --remote=origin --push
   ```
2. **Create accounts and capture secrets** — all free tiers:
   - Supabase → create project → copy `SUPABASE_URL` and `service_role` key
   - Resend → verify `glassnote.site` domain → create API key → set `RESEND_FROM_EMAIL=auth@glassnote.site`
   - Lemon Squeezy → create store + one variant ("Pro Monthly") → copy webhook signing secret + API key + store/variant IDs
   - Fly.io → install CLI (`brew install flyctl`) → `fly auth signup`
   - Sentry → create Node project → copy DSN
   - Axiom → create dataset `glassnote-api` → copy token
   - PostHog → create project → copy API key
3. **Buy a Windows code-signing cert** (~$100–500/yr from SSL.com, DigiCert, Sectigo). Long lead time for verification.
4. **Create the public client repo on GitHub.** Push this directory. Then update `package.json` `build.publish.owner` from the current `REPLACE_WITH_YOUR_GITHUB_USERNAME` placeholder.
5. **Run the BE locally to smoke-test:**
   ```bash
   cd ../glassnote-api
   cp .env.example .env
   # paste secrets from step 2; generate TRIAL_JWT_SECRET / LOG_SALT / HWID_SALT via: openssl rand -hex 32
   npx supabase link --project-ref <your-ref>
   npm run db:migrate
   npm run dev
   curl http://localhost:3000/health   # → {"status":"ok",...}
   ```
6. **(Once 1–5 are done, ping the agent to proceed with Week 2: `/v1/chat` SSE + Gemini integration.)**

---

---

## P0 — License & Attribution (one-time, do first)

- [x] **Add License & Attribution section to README** — done. See [README.md](README.md) just above Star History.
- [ ] **Add in-app "Source" link.** Settings → About panel must surface a link to the fork's GitHub repo. Required by AGPL §13 for any user of a hosted version. **Where:** `src/components/AboutSection.tsx`. **Accept:** clicking the link opens the fork repo URL via `openExternal`.
- [ ] **Add "Source" link to website footer.** Same URL. **Where:** marketing site (separate repo — defer until site exists).
- [x] **Final name + domain:** Glassnote / `glassnote.site` (`.com` unavailable; `.site` is fine for v1).
- [x] **Apple Developer ID** — in hand.
- [ ] **Windows code-signing cert** — still required ($100–500/yr).
- [ ] **Open accounts (~5 min each):** Fly.io, Supabase, Lemon Squeezy, Sentry, Axiom, PostHog, Resend.

---

## P0 — Backend decisions (DONE)

All 12 decisions answered. Recorded at the bottom of this file with "✅ chosen" markers. Full implementation plan is in [BACKEND.md](BACKEND.md). One open product decision remains:

- [ ] **Decide launch price** (BACKEND.md §18 open question). Recommended: $20/mo to match Cluely's anchor. Required before Week 3 of the BE build.

---

## P1 — Security remediation (BLOCKS public release)

Sourced from [AUDIT.md](AUDIT.md). Most items live in `natively-api/server.js` which is empty in this working tree — these get re-litigated when you stand up your own backend (see `BACKEND.md`). Below are the items that touch the **client repo** you actually have.

- [ ] **Scrub upstream API keys and secrets from client.** Grep for `AIza`, `gsk_`, `sk-`, `natively_sk_` across `src/`, `electron/`, `scripts/`, dotfiles. Confirm none are committed. **Accept:** `git grep -E 'AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|natively_sk_[A-Za-z0-9]{20,}'` returns nothing.
- [ ] **Confirm `.env` files are gitignored and not bundled.** Check `.gitignore` and `vite.config.mts` / `electron-builder` config. **Accept:** building the app, then unzipping the asar, contains no `.env`.
- [ ] **Replace auto-update feed URL.** Currently points at upstream's release server — auto-update would silently restore upstream branding/binaries. **Where:** search for `electron-updater` config / `feedURL`. **Accept:** points at your own GitHub releases or update bucket.
- [ ] **Replace Google Analytics measurement ID.** **Where:** `index.html`, plus any GA initialization in renderer. **Accept:** no `G-` ID belonging to upstream remains.
- [ ] **Tighten CSP `connect-src`.** Remove `campaign-sand.vercel.app` (upstream's domain). Replace with your own backend host. **Where:** `index.html` meta CSP. **Accept:** no upstream domains remain.
- [ ] **Replace Apple code-signing identity.** Current `ad-hoc-sign.js` produces "damaged app" warnings. **Where:** `scripts/ad-hoc-sign.js` + `electron-builder` config. **Accept:** signed builds open on a clean macOS without quarantine warning. **Requires:** Apple Developer ID ($99/year).
- [ ] **Replace Windows code-signing certificate.** **Requires:** EV or OV code signing cert ($100–500/year).

---

## P1 — Backend implementation

Code is in **`../glassnote-api/`** (sibling directory, private repo — initialize separately with `cd ../glassnote-api && git init`). Detailed plan: [BACKEND.md](BACKEND.md). High-level:

- [x] **Week 1** — Fly config, Supabase migrations, magic-link auth, `/v1/me`, `/v1/trial/*`, `/v1/usage`, Lemon webhook, `/v1/transcribe` 503 stub. Typechecks cleanly. **Not yet deployed** — needs accounts + secrets (see "Your turn" below).
- [ ] **Week 2** — `/v1/chat` with Gemini SSE pass-through, per-turn Axiom telemetry, IntentClassifier integration.
- [ ] **Week 3** — Lemon Squeezy product + checkout URL swap on client, subscriptions enforcement, per-user daily $ ceiling, global circuit breaker (Redis).
- [ ] **Week 4** — Groq fallback path, `/v1/embed`, PostHog events, security checklist sweep ([BACKEND.md](BACKEND.md) §13).
- [ ] **Week 5** — Closed beta with 10–20 invited users.
- [ ] **Week 6+** — Open launch. Ship [LATENCY.md](LATENCY.md) A–C before paid traffic ramps.

Client-side changes ([BACKEND.md](BACKEND.md) §14):
- [x] Replace `https://api.natively.software` → `https://api.glassnote.site` (11 occurrences across 5 files in `electron/`).
- [x] `package.json`: `name`, `productName`, `appId`, permission strings updated. **Publish config left as `REPLACE_WITH_YOUR_GITHUB_USERNAME` — update once you create the public client repo.**
- [x] CSP in `index.html` updated: added `api.glassnote.site` + `wss://api.glassnote.site`, removed `campaign-sand.vercel.app`, title→Glassnote, GA verification meta tag removed (re-add yours after Search Console verification).
- [ ] Register `glassnote://` protocol handler in `electron/main.ts` (for magic-link redirect — server already redirects to it).
- [ ] Swap Dodo checkout URLs → Lemon Squeezy in `src/config/urls.ts` and 5 other files (Week 3).
- [ ] Rename API key prefix `natively_sk_` → `glassnote_sk_` in client validation (Week 3; server already issues `glassnote_sk_`).
- [ ] Hide unused 4-tier UI in `src/components/settings/NativelyApiSettings.tsx` (single-tier per D1).
- [ ] Set `LocalWhisperSTT` as default; mark hosted STT "coming soon" badge.
- [ ] Replace `assets/natively.icns`, `assets/icon.png`, etc with Glassnote brand assets (file paths in `package.json` still reference `natively.icns`; rename after icon design lands).
- [ ] Rename `localStorage` key `natively_resolved_theme` → `glassnote_resolved_theme` after v0.2 (keeping for one-version migration in case any test installs exist).

---

## P2 — Rebrand (after BE works end-to-end)

Two layers: identity (must) and surface treatment (should). See [UI_UX.md](UI_UX.md) for the design direction; this section is mechanical changes.

### Identity (must do before public release)

- [ ] **Change app name.** **Where:** `package.json` (`name`, `description`, `build.productName`, `build.appId`), `index.html` `<title>`, every "Natively" string in `src/` and `electron/`. **Accept:** `git grep -i natively` returns only LICENSE attribution + commit history.
- [ ] **Replace app icon.** **Where:** `assets/icon.png`, `assets/natively.icns`, `assets/icon.ico`, `src/components/icon.png`, `src/components/NativelyLogoMark.tsx`. **Accept:** all icons render in dock/taskbar/about pane.
- [ ] **Rename `NativelyLogoMark`, `NativelyInterface`, `NativelyQuotaBanner`, etc.** Components and their files. **Accept:** TypeScript builds clean, `git grep Natively` returns nothing in `src/`.
- [ ] **Rename API key prefix.** `natively_sk_` → your prefix. **Where:** client validation + backend. **Accept:** new keys carry new prefix; old keys still validate during migration window.
- [ ] **Replace bundle ID `com.electron.meeting-notes`.** **Where:** `package.json` `build.appId`. **Accept:** matches your domain (reverse-DNS).
- [ ] **Replace support email + Telegram channel.** **Where:** search for `evinjohnn`, hardcoded email addresses, Telegram URLs. **Accept:** no upstream contact info reachable.

### Surface treatment (do after identity)

- [ ] **Implement design tokens in `tailwind.config.js`.** See [UI_UX.md](UI_UX.md). **Accept:** no raw `slate-*`/`gray-*` color classes in `src/components/` — all go through brand/accent tokens.
- [ ] **Replace typeface.** **Where:** `index.html` font import + Tailwind config. **Accept:** Inter replaced; new font loads without FOUT.
- [ ] **Restyle window chrome.** **Where:** `electron/WindowHelper.ts` + renderer overlay styles. **Accept:** corner radius, shadow, blur differ visibly from upstream.
- [ ] **Replace icon set.** **Where:** `lucide-react` imports across `src/components/`. **Accept:** consistent icon family throughout.
- [ ] **Add "live state" header to overlay.** Listening / Thinking / Answering / Idle. **Where:** `src/components/NativelyInterface.tsx`. **Accept:** state changes are visually obvious within 100ms of mode switch.

---

## P2 — Observability (do during BE work, not after)

See **Observability** section at bottom of this file. Pick stack, then:

- [ ] **Add Sentry to client (`electron/` + `src/`).** **Accept:** a thrown error in renderer shows up in Sentry within 30 s.
- [ ] **Add Sentry to backend.** **Accept:** same for a thrown 500.
- [ ] **Add per-turn JSON telemetry log line** (see [LATENCY.md](LATENCY.md) bottom). **Accept:** one line per LLM turn with `ttft_ms`, `cached_tokens`, etc.
- [ ] **Ship telemetry to chosen logs backend (Axiom / Better Stack).** **Accept:** TTFT p50/p95 visible on a dashboard.
- [ ] **Add PostHog with key product events** (`meeting_started`, `answer_emitted`, `upgrade_clicked`). **Accept:** funnel from install → first answer → upgrade is queryable.

---

## P3 — Latency wins

See [LATENCY.md](LATENCY.md). All items there blocked on observability landing first.

---

## P3 — UI/UX refinement

See [UI_UX.md](UI_UX.md).

---

# Backend decisions (LOCKED)

All 12 answered. Plan written in [BACKEND.md](BACKEND.md).

| # | Decision | Choice |
|---|---|---|
| D1 | Pricing model | ✅ Flat monthly subscription, one tier, soft usage cap |
| D2 | Trial flow | ✅ 30-min HWID-bound (reuses existing client trial code) |
| D3 | Payment provider | ✅ Lemon Squeezy (MoR, handles global tax) |
| D4 | Inference providers | ✅ Gemini + Groq at launch (Claude/OpenAI as future fallback) |
| D5 | Hosting | ✅ Fly.io |
| D6 | DB + auth | ✅ Supabase |
| D7 | Client auth | ✅ Email magic link → per-install API key |
| D8 | Region | ✅ US-East v1, EU after 100 users |
| D9 | Streaming | ✅ SSE pass-through |
| D10 | Cost ceilings | ✅ Per-user daily $ cap + global circuit breaker |
| D11 | Privacy | ✅ No server-side transcript persistence |
| D12 | Observability | ✅ Sentry + Axiom + PostHog |
| — | STT for v1 | ✅ LocalWhisperSTT only; hosted = v2 (BACKEND.md §8) |
| — | Calendar OAuth proxy | ✅ Cut from v1 (BYO via Google Cloud Console) |
| — | Backend visibility | ✅ Private repo. Client fork stays public AGPL (BACKEND.md §18) |
| — | Apple Developer ID | ✅ In hand |

**Still open** (BACKEND.md §18): launch price, exact trial-time semantics, refund policy wording, GDPR DSAR endpoint timing, final fork name (lean glassnote.site).

---

## Notes on the existing client wiring (informs decisions above)

- **Trial system is already built.** `CredentialsManager.ts:60-62` stores `trialToken`, `trialExpiresAt`, `trialStartedAt`, `trialClaimed`. The trial-claim UI exists at `src/components/trial/FreeTrialBanner.tsx` and `FreeTrialModal.tsx`. Backend just needs to issue the signed token; format and HWID-binding logic are already client-side.
- **Four-tier paid plan UI is already built** — see `src/components/settings/NativelyApiSettings.tsx`. If you choose D1(a) instead of D1(b), you'll delete this UI; if D1(b), you keep it and just swap checkout URLs.
- **Checkout URLs are hardcoded to Dodo.** `src/config/urls.ts:10-18` and `src/components/trial/FreeTrialModal.tsx:15-18`. If D3 ≠ (e), replace all of these.
- **Quota banner is already built.** `src/components/NativelyQuotaBanner.tsx`. Backend just needs to return `quota.used` / `quota.limit` / `quota.resets_at` in the same shape the client already expects.

The practical takeaway: the BE plan is closer to "build a Supabase-backed Express server that speaks the protocol the existing client already speaks" than "design a backend from scratch". Roughly 1–2 weeks of focused work, not 1–2 months.
