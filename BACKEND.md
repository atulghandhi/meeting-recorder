# Backend Implementation Plan

A hosted backend that lets users pay once and use the app — no API key setup, no provider accounts. Replaces upstream's `natively-api` with one that speaks the protocol the existing client already expects.

**Locked decisions** (from TODO.md):
- **D1 Pricing:** flat monthly subscription, one tier, soft usage cap
- **D2 Trial:** 30-min HWID-bound, reuses existing client trial code
- **D3 Payments:** Lemon Squeezy (Merchant of Record)
- **D4 Providers:** Gemini + Groq at launch (Claude/OpenAI as future fallback)
- **D5 Hosting:** Fly.io
- **D6 DB+Auth:** Supabase
- **D7 Client auth:** email magic link → long-lived per-install API key
- **D8 Region:** US-East v1, add EU after 100 users
- **D9 Streaming:** SSE pass-through
- **D10 Cost ceilings:** per-user daily $ cap + global circuit breaker
- **D11 Privacy:** no server-side transcript persistence
- **D12 Observability:** Sentry + Axiom + PostHog

---

## 1. Architecture

```
Desktop client (Electron)
        │
        │  HTTPS (SSE for streams)         WSS (audio frames)
        ▼                                  ▼
┌────────────────────────────────────────────────────────┐
│  Fly.io app: api.<yourdomain>                          │
│  Node 20 + Fastify (or Hono)                           │
│                                                        │
│  ├─ Auth middleware (API key → user)                   │
│  ├─ Quota middleware (per-user $ + global breaker)     │
│  ├─ Provider router (Gemini primary, Groq fallback)    │
│  ├─ SSE proxy (no buffering, pass-through)             │
│  ├─ WSS proxy → Deepgram (transcribe)                  │
│  └─ Webhook handler (Lemon Squeezy, magic-link)        │
└────────────────────────────────────────────────────────┘
        │                       │                  │
        ▼                       ▼                  ▼
   Supabase                 Providers          Lemon Squeezy
   (Postgres + Auth)        (Gemini, Groq,     (checkout +
                             Deepgram)          webhook)
        │
        ▼
   Background worker (BullMQ on Upstash Redis, or pg-boss):
   - usage rollups
   - daily $ ceiling check
   - magic-link expiry sweep
   - cache-keepalive pings
```

**One process for v1.** Fastify HTTP server + a small in-process job runner. Add a separate worker dyno when sustained load justifies it. Anything that would block the request critical path (DB writes for usage, webhook persistence) goes through `setImmediate` + a queue, never inline.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node 20 LTS** | Matches client SDKs, broad provider support |
| Framework | **Fastify** (or Hono) | Faster than Express, built-in JSON-schema validation, mature SSE support |
| Hosting | **Fly.io** | Multi-region from day 1 when you need it, simple deploy, generous free allowance |
| DB | **Supabase Postgres** | Existing schema (`api_keys`, `pro_licenses`); free tier covers 0–1k users |
| Auth | **Supabase Auth (magic link)** | Skip building OTP/email infra yourself; server still issues custom API keys |
| Cache / queue | **Upstash Redis** (free tier) or **pg-boss** | Rate-limit counters, idempotency, background jobs |
| Payments | **Lemon Squeezy** | MoR — they handle global VAT/sales tax; webhook-driven license activation |
| Errors | **Sentry** | Errors, perf traces; SDK for Fastify |
| Logs/telemetry | **Axiom** | Per-turn JSON log lines; queryable in seconds |
| Product analytics | **PostHog** | Funnels (install → first answer → upgrade), retention |
| Secrets | **Fly.io secrets** | `fly secrets set` — never in env files |

Pinned versions go in `package.json` once we start building. No new framework choices to make mid-build.

---

## 3. Endpoints (must match existing client)

The client at `electron/ipcHandlers.ts` and `electron/LLMHelper.ts` already calls these paths. Don't rename them — match exactly so client changes are minimal.

| Method | Path | Purpose | Streaming? |
|---|---|---|---|
| POST | `/v1/chat` | Single-turn chat with optional system prompt + images | SSE |
| POST | `/v1/chat/completions` | OpenAI-compatible shape (already in client) | SSE |
| POST | `/v1/embed` | Text embeddings (RAG) | No |
| GET | `/v1/usage` | Returns `{ used, limit, resets_at }` for quota banner | No |
| POST | `/v1/trial/start` | Issues signed trial token bound to HWID | No |
| GET | `/v1/trial/status` | Returns trial expiry + minutes remaining | No |
| POST | `/v1/trial/convert` | Marks trial as converted post-purchase | No |
| GET | `/v1/me` | Current user info — license tier, email | No |
| POST | `/auth/magic-link/request` | Send magic link email | No |
| GET | `/auth/magic-link/verify` | Verify token, issue API key, redirect to `app://...` deeplink | No |
| POST | `/webhooks/lemon-squeezy` | License activation / cancellation | No |
| GET | `/health` | Liveness check — minimal info, no pool counts (per AUDIT.md Low §1) | No |
| WSS | `/v1/transcribe` | NativelyProSTT — proxies to Deepgram WS, bills per-second | Yes (WS) |

**Calendar OAuth proxy (`/api/calendar/exchange` and `/refresh`)** — **cut from v1**. Removed entirely. The existing client supports BYO calendar credentials via Google Cloud Console for any user who needs it; the proxy adds attack surface (per AUDIT.md High §2) for a low-frequency feature. Document this as "feature parity gap" in release notes. Reconsider only if multiple paying customers explicitly ask.

**WSS `/v1/transcribe`** — route is reserved but returns `503 Coming Soon` in v1. See §8 for the v2 plan.

---

## 4. Data model (Supabase)

Six tables. Mostly mirrors upstream's schema so existing client code reading `quota.used` / `quota.limit` / `quota.resets_at` works without changes.

```sql
-- One row per signed-in user
create table users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  created_at      timestamptz default now(),
  last_seen_at    timestamptz,
  last_ip_hash    text,                     -- sha256(ip + salt), rolled 30 days
  deleted_at      timestamptz               -- soft delete for GDPR
);

-- One row per install. A user can have multiple (laptop + desktop).
create table api_keys (
  key_hash        text primary key,          -- sha256(plaintext_key); never store plaintext
  key_prefix      text not null,             -- first 12 chars for display ("yourbrand_sk_a1b2…")
  user_id         uuid references users(id) on delete cascade,
  hwid_hash       text,                      -- optional HWID binding
  label           text,                      -- "MacBook Pro"
  created_at      timestamptz default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

-- Active paid subscription (1:1 with user for v1 single-tier)
create table subscriptions (
  user_id            uuid primary key references users(id) on delete cascade,
  status             text not null,          -- 'active' | 'past_due' | 'cancelled'
  lemon_subscription_id text unique,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Trial state. Separate table so HWID binding doesn't pollute users.
create table trials (
  hwid_hash       text primary key,          -- sha256(hwid + salt)
  ip_hash         text,                      -- abuse signal, NOT primary key
  started_at      timestamptz default now(),
  expires_at      timestamptz not null,      -- started_at + 30 minutes (wall clock)
  minutes_used    numeric default 0,         -- updated on each chat call
  converted_user_id uuid references users(id) -- non-null if trial → paid
);

-- Per-day usage rollup. One row per (user, date). Written by background worker.
create table usage_daily (
  user_id         uuid references users(id) on delete cascade,
  day             date not null,
  input_tokens    bigint default 0,
  output_tokens   bigint default 0,
  cached_tokens   bigint default 0,
  stt_seconds     numeric default 0,
  cost_usd_cents  integer default 0,         -- estimated; for $ ceiling
  request_count   integer default 0,
  primary key (user_id, day)
);

-- Idempotency for webhooks (Lemon Squeezy retries on 5xx)
create table webhook_events (
  id              text primary key,          -- provider event id
  provider        text not null,             -- 'lemon_squeezy'
  processed_at    timestamptz default now(),
  payload         jsonb                      -- for debugging, drop after 30 days
);

-- Magic-link tokens
create table magic_links (
  token_hash      text primary key,          -- sha256(plaintext)
  email           text not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  ip_hash         text                       -- abuse signal
);
```

**Indexes:**
- `api_keys (user_id)` — for "list my devices"
- `usage_daily (user_id, day desc)` — for quota banner
- `trials (expires_at)` — for sweep job
- `magic_links (expires_at)` — for sweep job

**Per D11: no transcripts. The above schema has nowhere to put one.** This is enforced by schema, not by policy — much harder to leak something that doesn't exist.

**RLS off in v1.** All access goes through the API server with the service-role key. RLS is for Supabase clients talking directly to Postgres; we don't do that. Revisit if we ever build a web dashboard that uses the Supabase JS SDK from the browser.

---

## 5. Authentication flow

```
1. User clicks "Sign in" in app
   → app opens browser to https://<yourdomain>/auth/magic-link?email=foo@bar.com
   → OR app POSTs /auth/magic-link/request directly (in-app email field)

2. Server:
   - Insert magic_links row with sha256(token), 15 min expiry
   - Send email via Resend (cheap, 100/day free) with link:
     https://api.<yourdomain>/auth/magic-link/verify?token=<plain>

3. User clicks email link
   → Server verifies token, creates/finds user, mints API key (32 random bytes
     → base62 → prefixed "yourbrand_sk_…"), inserts api_keys row with sha256.
   → Server redirects to: yourbrand://auth?key=<plain>&email=<email>
   → Electron's protocol handler catches it, calls CredentialsManager.setNativelyApiKey()
   → Client now sends `Authorization: Bearer yourbrand_sk_…` on every request.

4. Server validates on each request:
   - sha256(presented_key) → look up api_keys
   - If revoked or user.deleted_at → 401
   - Update last_used_at async (setImmediate, not awaited)
   - Attach { user_id, subscription_status } to request context
```

**Key plaintext is shown to the user ONCE** in the post-verify redirect; we never store it. Lost-key flow = sign in again, get a new key, old one auto-revoked.

**No password reset surface area, no MFA layer.** Magic links are the entire auth model.

---

## 6. Trial flow (reuses existing client code)

The client already stores `trialToken` / `trialExpiresAt` and signs it (per `CredentialsManager.ts:60`). Backend just needs to issue the token.

```
POST /v1/trial/start
Body: { hwid: "<client-generated>", ip: <derived from request> }

Server:
  hwid_hash = sha256(hwid + TRIAL_SALT)
  if trials.hwid_hash exists and not expired → return existing token
  if trials.hwid_hash exists and converted_user_id set → 403 "already converted"
  else:
    started_at = now
    expires_at = now + 30 minutes
    insert into trials
    token = HMAC-SHA256(TRIAL_JWT_SECRET, JSON({hwid_hash, expires_at, iat: now}))
    return { token, expires_at, started_at }

POST /v1/chat (trial path)
  Validate token: HMAC matches AND expires_at > now AND minutes_used < 30
  Track minutes_used (estimate from stream duration)
  When minutes_used >= 30: return 402 "trial expired"

POST /v1/trial/convert
  Body: { token, user_id (from current API key) }
  Mark trials.converted_user_id = user_id
  Hides "claim trial" UI on this HWID forever (matches client trialClaimed flag)
```

**Hard fail on missing `TRIAL_JWT_SECRET`** (per AUDIT.md High §2 — don't repeat upstream's hardcoded-fallback mistake).

---

## 7. Inference routing

```
POST /v1/chat
  → choose provider:
       primary   = Gemini Flash
       fallback  = Groq llama-3.3-70b (if Gemini 429/5xx)
       fallback2 = Groq llama-3.1-8b-instant (if 70b OOC)
  → open SSE response to client
  → call provider streaming API
  → pipe each chunk to client (NO buffering, NO transformation, NO awaiting)
  → on success: enqueue { user_id, provider, in_tokens, out_tokens, ts }
  → on error mid-stream: SSE event `{type: "error", code, message}` + close
```

**SSE pass-through implementation** (Fastify):

```ts
reply.raw.setHeader('Content-Type', 'text/event-stream');
reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
reply.raw.setHeader('Connection', 'keep-alive');
reply.raw.setHeader('X-Accel-Buffering', 'no');  // disable proxy buffering
reply.hijack();  // tell Fastify we own the response

const upstream = await geminiStream(req.body);
for await (const chunk of upstream) {
  reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
reply.raw.write('event: done\ndata: {}\n\n');
reply.raw.end();
```

**Why this matters for latency:** any sync work between provider chunk and client write adds to TTFT. Quota check happens *before* the stream opens; billing happens *after* it closes (async). The only thing on the hot path is the byte copy.

**Connection reuse:** keep a singleton `GoogleGenAI` client per process, with HTTP/2 keep-alive enabled. Cold TLS handshake is ~150ms; reuse drops that to ~5ms.

**Pre-warming:** at process boot, fire a no-op `models.list()` against Gemini and Groq. Same for STT (Deepgram WS open held idle, reconnect on close).

---

## 8. STT — v1 LocalWhisper only, v2 adds hosted

**Locked: v1 ships with `LocalWhisperSTT` as the only STT option.** Zero per-user cost, zero new attack surface, fully offline-capable. Settings UI shows "Cloud transcription" as a disabled option with a "Coming v2" badge so users know the upgrade path exists.

### v2 hosted STT (architecture must accommodate today)

When v2 lands, the addition should be ~3 days of work, not a re-architecture. To preserve that:

- **Keep the WSS endpoint reserved.** Client already speaks `wss://api.<yourdomain>/v1/transcribe` (per `electron/audio/NativelyProSTT.ts:65`). v1 server should respond `503 Coming Soon` to that path, not 404 — confirms the route is owned.
- **`usage_daily.stt_seconds` column exists in the schema** (already there in §4). v1 just leaves it at 0. v2 starts incrementing it.
- **Cost ceiling logic in §10 should compute total spend = chat_tokens_cost + stt_seconds_cost.** v1 stt_seconds is always 0, so it's a no-op until v2.
- **`subscriptions` row already implies STT entitlement.** No separate "STT add-on" SKU at v1 means no migration when v2 ships — flipping the feature on globally is a config change, not a billing change.
- **When v2 ships:** add Deepgram WS proxy, validate API key in `Sec-WebSocket-Protocol` header (Bearer doesn't work on browser WS but Electron's WS supports custom headers — already done in client), open upstream Deepgram WS, pipe audio frames bidirectionally, increment `stt_seconds` on close. Standard pattern.

### Why LocalWhisper is the right v1 default

- ~$0.26/hr per user on Deepgram. At 100 paying users averaging 10 hrs/mo, that's an extra ~$260/mo COGS — meaningful at 100-user scale.
- LocalWhisper runs on-device → zero round trip, zero server CPU, latency is bounded only by user hardware.
- "Audio never leaves your machine" is the privacy story that *actually distinguishes you from Cluely*. Burning it on v1 would be a marketing mistake.
- ~30% of users (older laptops, accents, noisy rooms) will eventually want hosted. v2 captures them; v1 doesn't need to.

---

## 9. Lemon Squeezy integration

### Checkout
- One product, one variant for v1: "Pro Monthly" at your chosen price.
- Replace all `dodopayments.com` URLs in `src/config/urls.ts`, `src/components/trial/FreeTrialModal.tsx`, `src/components/NativelyQuotaBanner.tsx`, `src/components/settings/NativelyApiSettings.tsx` with the Lemon Squeezy checkout URL.
- Pass `checkout_data[email]` so the customer's email pre-fills and matches their app account.
- Pass `checkout[custom][user_id]` so the webhook can attribute the purchase.

### Webhook (`POST /webhooks/lemon-squeezy`)
- Verify signature with `X-Signature` header against `LEMON_WEBHOOK_SECRET` (HMAC-SHA256). **Reject before doing anything else.** Per AUDIT.md High §1, don't accept on chat-id-style trust.
- Check `webhook_events.id` for idempotency (Lemon Squeezy retries on any non-2xx).
- Events to handle:
  - `subscription_created` → upsert subscriptions row, status=active
  - `subscription_updated` → update period_end, cancel_at_period_end
  - `subscription_cancelled` → status=cancelled
  - `subscription_payment_failed` → status=past_due, send email
  - `subscription_payment_recovered` → status=active
- ALL persistence inside the request — `setImmediate` patterns can lose webhook writes on Fly's redeploy SIGTERM (per AUDIT.md Medium §5). Webhook handlers run sync; that's fine, they're rare.
- Return 200 only after persistence succeeds.

### License check
- Client calls `GET /v1/me` on launch.
- Server returns `{ email, status: 'trial'|'active'|'past_due'|'cancelled', period_end }`.
- Client hides "Upgrade" CTA when `status === 'active'`, shows it otherwise.

---

## 10. Abuse / cost ceilings

Per D10: both per-user $ ceiling AND global circuit breaker.

### Per-user daily cap
- Soft cap: $1.50/day equivalent token spend. Configurable in `subscriptions` per user (defaults to global).
- Implementation: `usage_daily.cost_usd_cents` updated by background worker after each request closes.
- Before serving a new request: `SELECT cost_usd_cents FROM usage_daily WHERE user_id = $1 AND day = current_date`. If > 150, return 429 with `Retry-After: <seconds-to-midnight-UTC>`.
- Pricing model: token cost estimate from provider published rates. Conservative rounding up. Recalc weekly as Gemini/Groq prices drift.

### Global circuit breaker
- Redis counter: `INCRBY global:spend:today $cents` per request close.
- Threshold: $50/day total at v1 (~50 active heavy users worth of spend). Configurable.
- When breached:
  - Return 503 to all chat requests for 5 minutes
  - Send Sentry alert + email to ops
  - Log the top 10 users by spend in last hour
- Re-check on 5-minute timer; reset at UTC midnight.

This isn't perfect (Redis counter race conditions) but it's *good enough* to prevent a leaked key from generating a $5k Gemini bill overnight. The audit's "raw API keys in logs" bug at upstream cost them exactly this — don't repeat it.

### Hot-path guards
- Per-IP rate limit: 60 req/min via Fastify rate-limit plugin
- Max body size: 4 MB (matches existing client's image limit)
- Per-image byte cap: 1 MB each, max 4 images (per AUDIT.md Medium §4)
- Connection timeout: 5 min for streaming endpoints, 10s for everything else

---

## 11. Observability wiring

### Sentry
- `@sentry/node` in server `index.ts` before any other imports. `tracesSampleRate: 0.1` initially; bump if quiet.
- `@sentry/electron` in renderer (`main.tsx`) and main (`electron/main.ts`).
- Use Sentry breadcrumbs for: provider switch, quota check, webhook receive.
- Don't send PII: configure `beforeSend` to strip `email`, `Authorization`, request bodies > 1kb.

### Axiom (per-turn telemetry)
- One log line per chat completion. The schema from [LATENCY.md](LATENCY.md):

```json
{
  "ts": "2026-05-16T14:23:01Z",
  "turn_id": "uuid",
  "user_id": "uuid",         // omit for trials
  "trial": true,             // if trial
  "intent": "qa|coding|...",
  "ttft_ms": 412,            // time-to-first-token
  "total_ms": 2871,
  "input_tokens": 1840,
  "cached_tokens": 1620,     // Gemini cachedContentTokenCount
  "output_tokens": 220,
  "provider": "gemini",
  "model": "gemini-2.0-flash",
  "speculative_fired": true,
  "speculative_reused": true,
  "fallback_used": false,
  "cost_usd_cents": 3
}
```
- Dashboard with three panels: TTFT p50/p95 over time, cache hit rate, provider mix.
- Alert: TTFT p95 > 2000 ms sustained for 5 min.

### PostHog
- Events: `meeting_started`, `first_answer_emitted`, `trial_started`, `upgrade_clicked`, `subscription_activated`, `subscription_cancelled`.
- Funnel: install → trial_started → first_answer_emitted → upgrade_clicked → subscription_activated.
- Retention: weekly cohorts on `meeting_started`.
- Identify users by hashed email (privacy) post-signin.

### Cost
- ~$0 at <1k users (all three free tiers). ~$80/mo at 10k users. Free tier ends well after you'd want to upgrade anyway.

---

## 12. Deployment (Fly.io)

### Initial setup
```bash
fly launch                              # creates fly.toml
fly secrets set \
  GEMINI_API_KEY=… \
  GROQ_API_KEY=… \
  DEEPGRAM_API_KEY=… \
  SUPABASE_URL=… \
  SUPABASE_SERVICE_ROLE_KEY=… \
  LEMON_WEBHOOK_SECRET=… \
  LEMON_API_KEY=… \
  TRIAL_JWT_SECRET=$(openssl rand -hex 32) \
  RESEND_API_KEY=… \
  SENTRY_DSN=… \
  AXIOM_TOKEN=… \
  POSTHOG_API_KEY=…
fly deploy
fly scale count 2 --region iad           # 2 machines for HA, US-East
```

### `fly.toml`
- `[http_service]` with `internal_port = 3000`, `force_https = true`
- `[[services.http_checks]]` on `/health`, 15s interval
- `[[vm]]` `cpu_kind = "shared"`, `cpus = 1`, `memory = "512mb"` — bump after measuring
- `[[mounts]]` — none needed; stateless
- `concurrency.hard_limit = 200` (Fastify can handle this on 512mb easily for proxy work)

### Domain
- Buy `<yourdomain>.com`
- Set `api.<yourdomain>` → Fly.io machines (Fly issues TLS cert automatically)
- Update every `https://api.natively.software/v1/` string in client → `https://api.<yourdomain>/v1/` (the rebrand work in TODO.md P2 already covers this)

### Add EU later (when D8 triggers)
```bash
fly scale count 2 --region fra           # Frankfurt
```
Fly Anycast routes users to nearest region. Postgres stays in US-East for v1 (Supabase doesn't multi-region on free tier); EU users pay one cross-region DB hop per request — negligible compared to provider latency, but worth a re-measure when you flip it on.

---

## 13. Security checklist (from AUDIT.md — applied to your new BE)

Each item is something upstream got wrong. Don't repeat.

- [ ] **`TRIAL_JWT_SECRET` hard-fails if missing** (upstream Audit High §2). `if (!process.env.TRIAL_JWT_SECRET) { process.exit(1) }` before listening.
- [ ] **Lemon Squeezy webhook verifies signature BEFORE any processing** (upstream Audit Critical §1 — Telegram webhook). Reject unsigned with 401.
- [ ] **API keys hashed in storage, never logged plaintext** (upstream Audit Critical §2). All log lines use `key_prefix` only.
- [ ] **No real API keys in test files or repo** (upstream Audit Critical §3). Use `.env.test` with throwaway keys.
- [ ] **`unhandledRejection` exits process** (upstream Audit High §4). Match `uncaughtException` behavior.
- [ ] **Webhook secret missing → fail-fast** (upstream Audit Medium §1). `process.exit(1)` at boot, not log-and-continue.
- [ ] **IP hashed before any log** (upstream Audit Medium §3). Use `sha256(ip + LOG_SALT)`.
- [ ] **Per-image byte cap** (upstream Audit Medium §4). 1 MB each.
- [ ] **Graceful shutdown awaits in-flight webhook persistence** (upstream Audit Medium §6). Track pending writes, await on SIGTERM.
- [ ] **`/health` returns minimal info** (upstream Audit Low §1). No pool sizes, no provider names.
- [ ] **No raw API key prefix in URLs or query params** — always Authorization header.
- [ ] **Magic link tokens single-use** — set `consumed_at`, reject re-use.
- [ ] **Rate-limit `/auth/magic-link/request` by email + IP** — prevent spam.

---

## 14. Client changes required

Most rebrand work is already listed in [TODO.md](TODO.md) P2. These are the BE-specific ones:

- [ ] **Replace `https://api.natively.software` → `https://api.<yourdomain>`** in `electron/LLMHelper.ts:1666,2982`, `electron/ipcHandlers.ts:1068,1108,1150,1195,1217`, `electron/audio/NativelyProSTT.ts:65`. Grep for it; expect ~10 hits.
- [ ] **Add `app://` protocol handler for magic-link redirect.** `electron/main.ts` — register custom protocol, parse `?key=…&email=…`, call `CredentialsManager.setNativelyApiKey()`.
- [ ] **Replace Dodo checkout URLs with Lemon Squeezy.** All occurrences in `src/config/urls.ts`, `src/components/trial/*`, `src/components/settings/NativelyApiSettings.tsx`, `src/components/NativelyQuotaBanner.tsx`.
- [ ] **Rename API key prefix.** `natively_sk_` → `<yourbrand>_sk_` in client validation regex (if any) and server generation. Grandfather old prefix during migration if you migrate any upstream users (you said no).
- [ ] **Delete or hide the 4-tier UI in `NativelyApiSettings.tsx`.** D1 chose single tier; the Standard/Pro/Max/Ultra selector is unused.
- [ ] **Wire `LocalWhisperSTT` as default STT.** If you defer hosted STT per §8, set the default provider in `electron/services/SettingsManager.ts` (or wherever STT default is chosen) and hide the NativelyProSTT option behind a "coming soon" badge.

---

## 15. Cost model (rough)

At 100 paying users at $20/mo = **$2,000 MRR**:

| Item | Cost/mo |
|---|---|
| Fly.io (2 machines × 512mb US-East) | ~$10 |
| Supabase (free tier, fits 100 users easily) | $0 |
| Upstash Redis (free tier) | $0 |
| Lemon Squeezy fees (5% + 50¢ × 100) | ~$150 |
| Gemini Flash (heavy user ~2M tokens/mo, light user ~200K) | ~$200 |
| Groq fallback (~5% of traffic) | ~$20 |
| Deepgram STT (v1: $0, LocalWhisper only — see §8) | $0 |
| Resend (transactional email, free under 3k/mo) | $0 |
| Sentry / Axiom / PostHog | $0 |
| Apple Dev + Windows code sign | ~$25 amortized |
| **Total COGS (v1)** | **~$405** |
| **Gross margin (v1)** | **~80%** |
| Gross margin (v2 with hosted STT enabled) | ~67% |

Math gets favorable fast. At 1k users you're at ~$20k MRR with ~$5k COGS → 75% margin. Inference cost per user *declines* with scale because the Gemini context cache hit rate goes up.

**Key sensitivity:** if you mis-size the daily $ ceiling (D10) and a power user spends $5/day for a month, that's $150 spent on a $20 subscription. The ceiling is what keeps the unit economics from going negative on heavy users.

---

## 16. Phased build plan

### Week 1: foundation
- Fly app, domain, Supabase project, secrets in place
- Migrations for the 6 tables
- Fastify scaffold with health check, Sentry, structured logging
- `/auth/magic-link/request` + `/verify` (Resend integration)
- `/v1/me` returning trial/active status

### Week 2: inference + trial
- `/v1/trial/start`, `/status`, `/convert`
- `/v1/chat` with Gemini, SSE pass-through
- Per-turn Axiom logging with TTFT
- Per-IP rate limit, body size limits
- Client: point base URL to new BE, test trial → chat end-to-end

### Week 3: payments + cost controls
- Lemon Squeezy product + webhook
- `subscriptions` table + status sync
- Quota check + per-user daily $ ceiling
- Global circuit breaker
- Client: swap Dodo → Lemon Squeezy URLs, hide unused tier UI

### Week 4: hardening + observability
- Groq fallback path with `/v1/chat/completions` shape
- `/v1/embed` for RAG
- PostHog events wired
- Apply every checkbox in §13 security checklist
- Load test: 50 concurrent chats sustained for 10 min

### Week 5: closed beta
- 10–20 invited users, free for 30 days, "founding member" framing
- Daily TTFT review, Sentry triage, cost-per-user check
- Iterate based on what breaks

### Week 6+: open launch
- Ship LATENCY.md A–C changes (cheap wins) before paid traffic ramps
- Marketing site + Source link footer (AGPL §13 compliance)
- Start working through TODO.md P2 rebrand items

---

## 17. Testing

### Automated
- **Endpoint contract tests** — for each endpoint in §3, assert request/response shape matches what the client expects. Run on every PR. If anything breaks the client contract, CI red.
- **Webhook signature test** — assert unsigned/mis-signed Lemon Squeezy webhooks return 401 without touching DB.
- **SSE pass-through test** — mock provider that emits 10 chunks at 50ms intervals; assert client sees first chunk within 100ms of mock provider's first emit (no buffering).
- **Quota ceiling test** — seed `usage_daily` over threshold; assert 429.
- **Idempotency test** — POST same webhook payload twice; assert single subscription row.
- **Trial expiry test** — fast-forward clock 31 min; assert 402.

### Manual (pre-launch)
- Real Lemon Squeezy test-mode purchase end-to-end, including refund.
- Pull network mid-stream on client; assert client reconnects + UI doesn't hang.
- Run app in a fresh VM with no API keys configured; full flow from sign-in to first answer in <60 s.
- Provider failure injection: 503 Gemini, assert Groq fallback within 1 retry.
- TTFT measurement on the same scripted dialogue as LATENCY.md §Testing.

---

## 18. Open questions / known risks

- **Price.** $15? $20? $25/mo? Compare against Cluely $20 / Final Round $149 / Otter $17. **Decision needed before week 3.**
- **Trial duration.** D2 locked 30 min — is that minutes of *meeting time* or wall clock? Existing client measures wall clock from `trialStartedAt`. Confirm that's the intent.
- **Refund policy.** Lemon Squeezy default is 14-day. Document explicitly on website for compliance.
- **GDPR DSAR endpoint.** Even with minimal PII, EU users can request export/deletion. Build `/v1/me/export` and `/v1/me/delete` by week 4 if accepting EU customers.
- **Apple notarization.** Required on macOS for distribution outside the App Store. Adds ~2 min to build, requires Apple Developer ID. Budget for this in week 4.
- **What happens when Gemini deprecates Flash 2.0?** Already happened to Flash 1.5 — keep the LLMHelper model-version code path flexible. Tag a model version with each turn in Axiom so you can A/B during migration.
- **Multi-device.** A user with laptop + desktop gets two api_keys rows. Quota is per-user (correct). Is the trial per-HWID intended to be per-device? Yes — that's the existing client design and the abuse-prevention rationale.
- **AGPL §13 and the backend.** Decision: **backend stays private.** Legally clean — AGPL only attaches to derivative works of the AGPL'd code, and a from-scratch Fastify server speaking the same protocol is not a derivative work of the client (calling AGPL code over a network does not infect the caller; implementing the same API shape does not infect the implementer). Source obligation only applies to the AGPL'd *client* fork. Operational benefits of closed BE: (a) fewer would-be competitors forking your stack one layer up, (b) bug-discovery surface area limited to your team + actual users, not random algorithmic vuln scanners pointed at GitHub. The trade-off is the "look, transparent" marketing story you give up — judgement call already made, not revisiting.
  - **Required:** the *client* fork repo stays public AGPL with the "Source" link from TODO.md P0.
  - **Required:** never copy code from upstream's `natively-api/server.js` into your private backend. If you do, that code becomes AGPL even inside a private repo, and you owe source the moment a user touches the hosted service. Build clean-room.
