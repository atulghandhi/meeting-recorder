# Latency Plan

Goal: reduce end-to-end **speech → on-screen answer token** latency so the assistant feels real-time. Target: p50 ≤ **800 ms** time-to-first-token (TTFT) from final transcript chunk, p95 ≤ **1500 ms**.

The pipeline already has the right architecture (streaming STT, streaming LLM, IPC token batching, speculative inference, prompt caching). Most wins are correctness/measurement, not new infrastructure.

---

## Current pipeline (ground truth from code)

```
mic / system audio
   └─► STT (LocalWhisper | Deepgram | ElevenLabs | Google | Soniox | OpenAI)
         └─► partial + final transcripts
               └─► IntelligenceEngine
                     ├─► IntentClassifier  (electron/llm/IntentClassifier.ts)
                     ├─► Speculative pre-fire on stable partials
                     │     (electron/IntelligenceEngine.ts:185-270)
                     └─► WhatToAnswerLLM.generateStream  ──┐
                           └─► LLMHelper.streamChat        │  token stream
                                 ├─► Gemini explicit cache │
                                 │   (electron/llm/GeminiPromptCache.ts)
                                 ├─► Groq / OpenAI prefix cache
                                 └─► Anthropic cache_control
                                                           ▼
                     IntelligenceEngine emits suggested_answer_token
                           └─► main.ts:2817 setImmediate batch
                                 └─► IPC 'intelligence-token-batch'
                                       └─► NativelyInterface.tsx renders
```

---

## Changes, ranked by impact / effort

### A. Fix `AnswerLLM` — currently buffers its own stream (BUG)

**Where:** [electron/llm/AnswerLLM.ts:14-27](electron/llm/AnswerLLM.ts)
**What:** `generate()` awaits the entire stream into `fullResponse`, then returns. The caller in [electron/IntelligenceEngine.ts:373](electron/IntelligenceEngine.ts) then emits a single `suggested_answer` event with the complete string — zero progressive rendering for this code path.
**Why it matters:** `AnswerLLM` is one of two answer paths. `WhatToAnswerLLM` already streams tokens; `AnswerLLM` does not. For users hitting the Answer path the perceived latency is the *full* generation time, not TTFT.
**Fix:** add a `generateStream()` overload returning `AsyncGenerator<string>`, mirror the consumer loop in `IntelligenceEngine.ts:373` to emit `suggested_answer_token` per chunk, fall back to the current `generate()` only for non-interactive callers.
**Expected:** -1500 to -3000 ms perceived latency on the Answer path.
**Effort:** 1–2 hours.

---

### B. Pre-warm LLM + STT connections at meeting start

**Where:** [electron/IntelligenceEngine.ts](electron/IntelligenceEngine.ts) `start()` / session-start hook; [electron/audio/](electron/audio/) streaming STT classes.
**What:** First request to Gemini/Groq pays TLS handshake + HTTP/2 connection setup (~150–400 ms cold). First STT WebSocket connect similar.
**Fix:**
- On meeting start, fire a no-op `models.list()` against the active provider to warm the TCP/TLS pool.
- For STT providers using WebSocket, open the socket as soon as the user clicks "Start", not on first audio chunk.
- Already exists for one path: `warmupIntentClassifier` at [electron/llm/index.ts](electron/llm/index.ts). Extend the pattern to the answer-path provider.
**Expected:** -200 to -400 ms on the first TTFT of the session.
**Effort:** 2–3 hours.

---

### C. Verify Gemini explicit-cache hit rate is actually >0

**Where:** [electron/llm/GeminiPromptCache.ts](electron/llm/GeminiPromptCache.ts), call sites in [electron/LLMHelper.ts](electron/LLMHelper.ts) (search `getOrCreate`).
**What:** Cache infra exists, but there is **no telemetry** confirming hit rate in production. Comment at `GeminiPromptCache.ts:30` notes server-side TTL is 1h; if the user pauses >1h between turns, every "hit" is silently a miss.
**Fix:**
- Log `usageMetadata.cachedContentTokenCount` from each Gemini response. Roll up per-session hit rate.
- Add a 50-min keepalive: if cache age > 50 min and a session is still active, force-refresh.
- Expose hit rate in the existing settings/dev panel.
**Expected:** confirmation of -30 to -50% input token cost AND -100 to -200 ms TTFT per turn (cached prefix processes faster server-side).
**Effort:** 3–4 hours.

---

### D. Two-tier inference: fast draft, slower refine

**Where:** New `electron/llm/DraftAnswerLLM.ts`; wire into [electron/IntelligenceEngine.ts](electron/IntelligenceEngine.ts) `_what_to_say` flow alongside the existing speculative path.
**What:** Run `gemini-flash-lite` (or `groq llama-3.1-8b-instant`) in parallel with the primary `gemini-flash` call. Stream the draft into the UI immediately; when the primary completes, atomically swap if it differs materially.
**Why:** Flash-lite first-token in ~200 ms vs flash in ~500–700 ms. Most answers don't need the larger model; the swap is invisible when the draft is correct.
**Risk:** UI flicker on swap. Mitigation: only swap if Jaccard similarity (already implemented at [electron/IntelligenceEngine.ts:175](electron/IntelligenceEngine.ts)) below threshold, otherwise keep draft.
**Expected:** -300 to -500 ms perceived TTFT on cold paths (where speculative inference didn't fire).
**Effort:** 1–2 days. Higher risk than A/B/C — defer until A/B/C measured.

---

### E. Tune speculative-inference thresholds

**Where:** [electron/IntelligenceEngine.ts:185-270](electron/IntelligenceEngine.ts) (`_maybeSpeculate`, Jaccard reuse logic).
**What:** Speculative inference exists but fires on a debounced confidence threshold. Current threshold may be too conservative — measure how often the speculative result is *reused* vs discarded.
**Fix:** Add per-trigger telemetry (`speculative_fired`, `speculative_reused`, `speculative_discarded`). If reuse rate <50%, the prefiring is wasted spend; if >80%, lower the confidence threshold to fire earlier.
**Expected:** depends on baseline. Best case -400 to -800 ms TTFT on a majority of turns by firing earlier on stable partials.
**Effort:** 1 day (instrumentation + tuning across a few real meetings).

---

### F. Shrink the prompt that goes over the wire

**Where:** [electron/llm/transcriptCleaner.ts](electron/llm/transcriptCleaner.ts) (`sparsifyTranscript`, `prepareTranscriptForWhatToAnswer`).
**What:** Confirm `sparsifyTranscript` actually runs in the hot path before the LLM call. The static system prompt (~1.7–3.7 K tokens per [GeminiPromptCache.ts:6](electron/llm/GeminiPromptCache.ts)) is cached; the *dynamic* transcript portion is not, and grows linearly with meeting length.
**Fix:**
- Cap rolling transcript window at the last N turns OR M tokens, whichever is smaller.
- Drop filler tokens and disfluencies more aggressively (already partially done — verify it runs).
- For long meetings, run `ConversationSummarizer` ([electron/llm/ConversationSummarizer.ts](electron/llm/ConversationSummarizer.ts)) to compress old context into a one-paragraph summary that replaces raw transcript.
**Expected:** -50 to -200 ms TTFT for meetings >15 min (input tokens dominate prefill time).
**Effort:** 1 day.

---

### G. Drop renderer-side rendering latency

**Where:** [src/components/NativelyInterface.tsx:1205](src/components/NativelyInterface.tsx) (`suggested_answer` / `intelligence-token-batch` consumer).
**What:** Tokens are already coalesced into a `setImmediate`-flushed batch in [electron/main.ts:2817](electron/main.ts). This is good. Verify the renderer doesn't add its own batching delay (React state updates, throttled setState, etc).
**Fix:** Profile with React Profiler during a streaming response. If state updates are batched >16ms, switch the token-buffer state to a `useRef` + manual `forceUpdate` or use `flushSync` on incoming batches.
**Expected:** -16 to -50 ms per visible chunk; cumulative effect on "feels responsive".
**Effort:** 4 hours including profiling.

---

### H. Skip post-processing on the streaming path

**Where:** [electron/llm/postProcessor.ts:118 (clampResponse), :283 (validateResponse)](electron/llm/postProcessor.ts).
**What:** Verify `clampResponse` / `validateResponse` are not blocking on the streaming path. They are designed for the *final* answer; running them mid-stream would force buffering.
**Fix:** Confirm via grep that streaming call sites do not invoke either, OR only invoke them after the stream completes (in the `suggested_answer` final-emit branch, not per-token).
**Expected:** Defensive — prevents regression rather than improving baseline.
**Effort:** 1 hour audit.

---

## Suggested order

1. **A** (AnswerLLM streaming bug) — biggest single win, smallest change.
2. **C** (cache telemetry) + **E** (speculative telemetry) in parallel — you cannot tune what you cannot measure.
3. **B** (connection prewarm) — easy and uncontroversial.
4. **F** (prompt size) — informed by data from C.
5. **G** + **H** — defensive, after the bigger items land.
6. **D** (two-tier inference) — last, highest risk, only if A–F don't get you to p50 ≤ 800 ms.

---

## Testing — automated

Create `electron/llm/__tests__/latency.test.mjs`:

- **TTFT harness.** Mock provider that emits 10 tokens at fixed intervals. Assert `IntelligenceEngine` emits the first `suggested_answer_token` within 50 ms of the LLM's first chunk (i.e. no buffering inserted by our code). Regression-guards change A.
- **Streaming-vs-buffering assertion for `AnswerLLM`.** After change A, assert `generateStream()` yields >1 chunk before the underlying stream closes. Catches accidental re-buffering.
- **Cache-key stability.** Hash the system prompt + model and assert it's stable across two `generateStream()` calls in the same session. If unstable, Gemini explicit cache never hits.
- **IPC batch coalescing.** Inject 50 tokens in a tight loop, assert `webContents.send` was called ≤5 times via a spy. Regression-guards the [electron/main.ts:2817](electron/main.ts) batch logic.
- **Speculative reuse path.** Drive the engine with a partial that matches a subsequent final at Jaccard >0.7; assert `suggested_answer` fires without a second LLM call. Regression-guards the reuse logic at [electron/IntelligenceEngine.ts:250-263](electron/IntelligenceEngine.ts).

Add a CI gate: TTFT harness p95 ≤ 100 ms (mock provider, so this is purely measuring our overhead, not network).

## Testing — manual

Use a fixed scripted dialogue (record once, replay through `electron/test/erp-mode-stress.ts` style harness):

1. **Cold-start TTFT.** Start app, start meeting, speak the first question. Wallclock from end-of-utterance to first visible token. Repeat 10×, report p50/p95.
2. **Warm TTFT.** Same, but with 10 prior turns in the session (cache warm, connection warm).
3. **Long-meeting TTFT.** After 30 min of conversation, measure TTFT. Sanity-checks change F.
4. **Speculative hit-rate.** Run a 20-turn scripted dialogue, count `speculative_reused` vs `speculative_discarded` log lines. Target >60% reuse.
5. **Provider comparison.** Run the same script against Gemini-flash, Groq llama-3.3-70b, Claude haiku. Record p50 TTFT per provider; document which is the default for new users.
6. **Subjective check.** A non-engineer uses the app for one real meeting. Asked unprompted: "does it feel real-time?" — answer must be yes.

## Telemetry to add (one-time)

Lightweight per-turn JSON log line written to a local debug file (gated behind a settings toggle, ON by default):

```
{ ts, turn_id, intent, ttft_ms, total_ms, input_tokens, cached_tokens,
  output_tokens, provider, model, speculative_fired, speculative_reused }
```