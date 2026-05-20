# Glassnote Marketing Site — Build Spec

A spec for a coding agent to build the marketing site at `https://glassnote.site`. This is a separate repo / separate deploy from the Electron app and the API backend.

**Important framing for the agent:** This is an **original site** for Glassnote. Reference category comparables (e.g. Cluely, Granola, Otter) only to understand the *kind* of page expected — above-fold value prop, demo loop, feature blocks, social proof, pricing, FAQ. **Do not copy any other site's specific copy, layout, distinctive animations, or visual elements.** Original creative work only. The design language is Apple's liquid glass (publicly described in Apple WWDC 2025 — macOS Tahoe / iOS 26), implemented from first principles.

---

## 1. Goals & non-goals

**Primary goal:** convert someone arriving via a "AI interview copilot" / "meeting AI" search into a paid Glassnote subscriber.

**Secondary goal:** satisfy Lemon Squeezy's MoR verification ("valid website URL showcasing your product"), AGPL §13 source-availability obligation, and basic legal pages (privacy, terms, refund).

**Non-goals (v1):**
- No blog, no docs site, no community forum, no changelog — adds maintenance overhead before there's anything to talk about.
- No A/B testing infrastructure — single variant until you have traffic.
- No user-account UI — the desktop app handles all account state.

---

## 2. Tech stack (mandatory)

- **Framework:** Next.js 15 (App Router) + TypeScript. Static export where possible (`output: "export"`).
- **Styling:** Tailwind CSS 4 + CSS variables for theme tokens. No CSS-in-JS, no styled-components.
- **Animations:** Framer Motion 11 for entrance/scroll animations. Native CSS `@keyframes` for ambient/looping effects.
- **3D / refraction (only if used in hero):** Three.js via `@react-three/fiber` + `@react-three/drei`, lazy-loaded.
- **Icons:** Lucide React.
- **Fonts:** see §6.
- **Hosting:** Vercel (free tier). Domain: `glassnote.site` (already owned).
- **Analytics:** PostHog snippet (use the project token already in `.env`).
- **No:** WordPress, no Webflow, no page builders, no jQuery, no Bootstrap.

---

## 3. Information architecture

```
glassnote.site/
├── /                       Hero · demo loop · features · social proof · pricing teaser · FAQ · CTA
├── /pricing                Full pricing page — single tier + trial + refund policy + FAQ
├── /privacy                Privacy policy (markdown-rendered)
├── /terms                  Terms of service (markdown-rendered)
├── /refund                 Refund policy (markdown-rendered, 14-day)
├── /download               Hosts the latest macOS .dmg / Windows .exe / Linux .AppImage (auto-detect OS, show appropriate primary button)
└── /source                 301 → github.com/atulghandhi/meeting-recorder (AGPL §13 source-availability redirect)
```

**Nav bar (sticky, both top and bottom on mobile):**

`[Glassnote logo]    Features   Pricing   FAQ   Download   →  [Get started CTA]`

The "Pricing" link is in the primary nav, not buried in a footer or pricing-on-scroll-only. Most category competitors hide pricing; we don't. Honest pricing is a conversion lever, not a leak.

**Footer:**

Four columns:
- **Product:** Features · Pricing · Download · Changelog (placeholder for v2)
- **Resources:** FAQ · Privacy · Terms · Refund policy
- **Open source:** Source code (→ /source) · License (AGPL-3.0) · Based on Natively (link to upstream)
- **Contact:** Email (support@glassnote.site) · X · LinkedIn

---

## 4. Page specs

### 4.1 Home (/)

**Above-the-fold (100vh, dark theme by default):**

- Top-left: logo wordmark.
- Top-right: nav.
- Center-left: H1 (52–72px desktop, 36–44px mobile). Original headline copy to be written; should communicate **invisible AI assistant for live meetings and interviews** in one sentence. Three drafts to choose from:
  - *"The AI copilot that listens, thinks, and answers — invisibly."*
  - *"Real-time AI for every meeting. Live notes. Live answers. Zero learning curve."*
  - *"Like having a brilliant friend in your ear during every interview, sales call, and standup."*
  (Pick one, don't use all three. None copy any specific competitor's headline.)
- Subhead beneath (18–22px, max 540px wide): one sentence on what the product does, in plain language. Mention live transcription + AI answers + privacy (on-device transcription is a genuine differentiator).
- Two CTAs:
  - Primary (filled, accent color): "Download for macOS" / "Download for Windows" (OS-detected via `navigator.userAgent`).
  - Secondary (ghost, outlined): "See it in action" — anchors to the demo loop section below.
- Right side: **product showcase**, see §5 for the visual treatment.

**Demo loop section (scroll-snap):**

A 720p autoplaying muted MP4 loop (≤6 MB, H.264, 12–18 seconds), encoded with `<video autoplay muted loop playsinline>`. Below it, three short captions that fade in sync with timestamps in the video, e.g.:
- 0:00–0:04 — "Glassnote listens."
- 0:04–0:09 — "Glassnote answers."
- 0:09–0:14 — "You stay in the conversation."

(Original captions, sync-keyed to your actual recording — the agent should make these timestamps configurable, not hardcoded.)

**Features section (3-up grid, scroll-triggered):**

Three features, each a card with: icon (Lucide), 2-word title, 2-sentence body. Suggested:
- **Real-time answers** — Live transcription with AI suggestions that appear before you finish hearing the question.
- **On-device by default** — Audio never leaves your machine unless you choose cloud transcription.
- **Built for your work** — Persona-aware: tunes itself to interviews, sales calls, standups, lectures.

Each card uses the liquid-glass treatment (see §5).

**Social proof section:**

For v1, this is awkward — there are no users yet. Options the agent should implement:
- A "Powered by" row showing logos of underlying tech (Google Gemini, Groq, Whisper, Electron) as a credibility proxy. Tasteful, not over-claiming partnership.
- A single quote from your own use ("Built this for myself after one too many interviews where I forgot a key talking point." — attributed to you by name + role) — honest, not fake testimonials.
- DO NOT generate fake user quotes. DO NOT use stock photos of "users".

**Pricing teaser (3-up):**

Three columns showing what's included with Glassnote Pro vs. a competitor's $99–149 tier vs. doing it yourself with ChatGPT. The Glassnote column is visually emphasized.

CTA at bottom: "See full pricing →" links to `/pricing`.

**FAQ accordion:**

Six questions, each <2 sentence answer. Suggested questions (write original answers):
- Is my meeting audio sent to a server?
- Does it work offline?
- What apps does it work with?
- Can interviewers/proctors detect it?
- Can I cancel anytime?
- Why open source?

**Final CTA strip:**

Repeats the primary download button + a one-liner. Original copy; do not copy a specific competitor's outro.

---

### 4.2 Pricing (/pricing)

Single-column, mobile-first. Three sections:

**Section 1 — The Pricing Card (one big card, liquid-glass treatment):**

```
GLASSNOTE PRO
$20 / month

✓ Unlimited meeting transcription (on-device)
✓ Unlimited AI-powered answers
✓ Works on macOS, Windows, Linux
✓ Cancel anytime — 14-day refund guarantee

[ Start 30-min free trial ]   — no card required
[ Buy now → ]                 — opens Lemon Squeezy checkout
```

The card has a subtle inner glow on hover and a "popular" / "all features" badge in the top-right corner. Price displayed prominently (48–64px, tabular numerals).

**Section 2 — Comparison table:**

Rows for ~8 features ("Live transcription", "AI answers", "On-device option", "Persona presets", "Privacy: audio leaves device?", etc.) × columns for: Glassnote ($20), Cluely-class competitor ($20), Premium competitor ($99–149), DIY with ChatGPT ($20+keys+setup). Use ✓ / ✗ / qualified text. Glassnote column visually emphasized (subtle highlight, not garish).

**IMPORTANT:** the agent should not name specific competitors in the public-shipped version unless legal review approves it. Use generic labels like "Mid-tier competitor", "Premium competitor". This avoids defamation/comparative-advertising exposure.

**Section 3 — Pricing FAQ:**

- "What's the soft fair-use limit?" — "Glassnote includes generous fair-use of ~$3 of inference per user per day, enough for ~60+ hours of intensive meeting AI. You'll only see this if a key leaks or a bug loops requests. If you ever hit it, email us — we'll usually fix it within the hour."
- "Can I bring my own API key instead?" — "Yes. In Settings → AI Providers, paste a Gemini, Groq, OpenAI, or Claude key. With your own key, you only pay $0 to us — but you're responsible for provider charges. The subscription includes our hosted inference; BYO is free."
- "What if I cancel?" — "Use Glassnote until the end of your paid period, then it reverts to trial state. We don't auto-downgrade your meeting history (it lives on your machine anyway)."
- "Refund policy?" — "14 days, no questions asked. Reply to any of our emails."

---

### 4.3 Static legal pages

`/privacy`, `/terms`, `/refund` — each renders a markdown file from `content/`. Plain typography, max-width 720px, no nav distractions, single back link to home.

For v1, the content is the user's responsibility (legal docs need a human). Agent should:
- Wire the markdown rendering (use `react-markdown` or MDX).
- Leave each file with placeholder content (`# Privacy Policy\n\nTBD — see content/privacy.md`).
- Add a TODO comment in each file pointing to a recommended template (e.g. Termly, Iubenda).

---

### 4.4 /source

A one-line `redirect` in `next.config.js`:
```js
{ source: '/source', destination: 'https://github.com/atulghandhi/meeting-recorder', permanent: false }
```

302 not 301 so the destination can change later.

---

## 5. Liquid-glass design language — implementation

Apple's liquid glass design language (introduced macOS Tahoe / iOS 26) is the visual reference. Implement from first principles using web primitives — **do not** copy any specific implementation from another site.

### 5.1 Color & tokens

Define in `tailwind.config.ts` and as CSS variables in `globals.css`:

```css
:root {
  /* Surfaces */
  --bg-base: 12 12 14;        /* near-black, slight warm tint — rgb triplet for arbitrary opacity */
  --bg-elevated: 22 22 26;
  --bg-glass: 255 255 255;     /* applied at low opacity */
  --bg-glass-strong: 255 255 255;

  /* Brand */
  --brand-50:  243 247 255;
  --brand-200: 188 211 255;
  --brand-500: 76  127 248;    /* primary accent — pick one color, stick with it */
  --brand-700: 38  77  192;
  --brand-900: 17  31  82;

  /* Text */
  --text-primary: 245 246 250;
  --text-secondary: 168 174 192;
  --text-tertiary: 110 117 137;
}
```

Light theme: invert surfaces, keep brand. Implement via `[data-theme="light"]` selector. Default dark.

### 5.2 The "liquid glass" effect — concrete CSS recipe

A glass surface in this design language is **not** just `backdrop-filter: blur(20px)`. Real liquid glass has:

1. **Backdrop blur** — `backdrop-filter: blur(28px) saturate(160%)`.
2. **Tinted translucency** — background `rgb(var(--bg-glass) / 0.04)` on dark, `0.6` on light.
3. **Edge highlight** — top edge gets a 1px linear-gradient border that fades from `rgba(255,255,255,0.18)` → transparent. Bottom edge gets nothing (asymmetric, like real glass with light from above).
4. **Specular reflection** — a `radial-gradient` overlay positioned via `background-position` that subtly tracks cursor (CSS custom properties + `mousemove` listener). 30% opacity at center, 0% at edges.
5. **Refraction at edges** — a faint SVG `<feDisplacementMap>` filter applied to the edge mask (not the whole element — too expensive). Optional; skip on mobile.
6. **Shadow:** layered. Outer: `0 32px 64px -16px rgba(0,0,0,0.5)`. Inner: `inset 0 1px 0 0 rgba(255,255,255,0.06)`.

Build this as a reusable `<GlassPanel>` component with props for `intensity` (subtle / medium / strong), `cursorTracking` (boolean), `borderHighlight` (boolean).

### 5.3 Hero showcase visual

Choose one of these treatments; ship a single one that's polished, not a kitchen sink:

**Option A: Floating window mockup with simulated AI response (recommended).**
A high-fidelity SVG/CSS mockup of the Glassnote overlay floating in 3D space against the dark hero. The overlay has a fake live transcript + a fake AI answer streaming in (typewriter effect, 30ms per character, loops every 8s). The overlay tilts subtly on cursor parallax (max ±6°). Behind it, a soft gradient and a 5×5 grid of dim dots for depth reference.

**Option B: Liquid-glass orb.**
A WebGL render of a soft glass-like sphere with internal light caustics, slowly rotating. Less product-focused but more visually distinctive.

**Option C: Skip the visual entirely.**
Above-the-fold is just type + CTA + a small screenshot embedded into a glass panel. Faster to ship, harder to differentiate.

**Recommendation: Option A.** It shows the product working, which is the whole point.

### 5.4 Typography

- **Display:** "Söhne" or "Inter Display" (variable-weight, optical sizing). Fallback to Inter, then SF Pro.
- **Body:** Inter or Geist (variable).
- **Mono:** JetBrains Mono (for any code/key snippets).
- Self-host fonts (`woff2` in `/public/fonts/`) to keep performance high. No Google Fonts CDN.
- Scale: type-scale 1.250 (major third). H1 64px → H2 48 → H3 32 → H4 24 → body 18 → small 14.

---

## 6. Motion language

A consistent motion vocabulary across the whole site. Define once, apply everywhere.

### 6.1 Easing curves

```js
const ease = {
  glide:  [0.16, 1, 0.3, 1],     // primary — entrances, transforms
  flick:  [0.5, 0, 0.3, 1],      // secondary — quick small movements
  thud:   [0.4, 0, 0.4, 1],      // exits, dismissals
};
```

Use these throughout — no inline custom curves.

### 6.2 Durations

```js
const dur = {
  instant: 0.12,
  quick:   0.2,
  base:    0.32,
  slow:    0.6,
  ambient: 1.2,   // hero loops only
};
```

### 6.3 Specific patterns

- **Hero text:** stagger-enter on mount. Each line: `opacity 0 → 1`, `y +12 → 0`, `dur.base`, `ease.glide`, stagger 0.06s between H1, subhead, CTAs.
- **Scroll-triggered cards (features, pricing):** as the section enters viewport (`useInView`), each card: `opacity 0 → 1`, `y +24 → 0`, `dur.base`, stagger 0.08s. Fires once per visit.
- **Buttons (hover):** scale `1 → 1.02`, `dur.quick`, `ease.flick`. Active: scale `0.98`, `dur.instant`.
- **Nav (sticky):** appears as a glass bar after 80px of scroll, `opacity 0 → 1`, `y -8 → 0`, `dur.base`.
- **Pricing card (idle):** subtle `box-shadow` glow pulse, `dur.ambient × 2`, infinite, `ease.glide`. Very low-amplitude — should be ambient, not distracting.
- **Glass cursor tracking:** specular highlight follows cursor at 60% damping (lerp). Use `requestAnimationFrame`, not `mousemove` listeners that thrash style updates.
- **FAQ accordion:** height auto via `framer-motion` `<AnimatePresence>` with `dur.base` `ease.glide`. Chevron rotates 0 → 180°.

### 6.4 What NOT to do

- No floating particles or moving backgrounds outside the hero.
- No scroll-jacking. Native scroll only. No "scrollytelling" sections that hijack scroll position.
- No autoplaying video with sound.
- No "Sign up to keep reading" pseudo-paywalls.
- No marketing pop-ups, cookie banners (use a non-blocking footer notice if GDPR consent is needed), or chat widgets.

---

## 7. Accessibility & performance budgets

**Accessibility:**
- All interactive elements keyboard-reachable, focus rings visible (use `:focus-visible`).
- Color contrast WCAG AA against the dark theme — verify with a tool (axe / Lighthouse).
- Reduced-motion: honor `prefers-reduced-motion: reduce` — disable all framer-motion entrance animations, freeze hero ambient loops at first frame.
- All images have `alt` text.
- Skip-to-content link at the top.

**Performance:**
- Lighthouse Performance ≥ 92 (mobile).
- LCP < 2.0s on simulated 4G mobile.
- Total transfer size for `/` < 500 KB before user interaction (excluding the demo MP4, which loads lazy).
- Hero video uses `<video preload="metadata">`, not `auto`.
- All images: `next/image` with explicit `width` + `height`.
- Three.js (if used) lazy-loaded with dynamic import; SSG pages still render without it.

---

## 8. SEO

- Each page has unique `<title>` and `<meta description>` via Next's metadata API.
- Open Graph image: a 1200×630 PNG of the hero. Static, served from `/public/og/`.
- One H1 per page. Logical heading hierarchy (no skipping levels).
- Generate sitemap.xml and robots.txt at build time.
- Schema.org: `Product` for the pricing page, `Organization` for the home page. JSON-LD blocks.

---

## 9. Deployment

- Repo: separate from the client repo. Name: `glassnote-site`. Public (so AGPL §13 source link can also point at the site repo if useful).
- Vercel project linked to `main` branch. Auto-deploy on push.
- Custom domain: `glassnote.site` (and `www.glassnote.site` → 308 redirect to apex).
- Environment variables: `NEXT_PUBLIC_POSTHOG_KEY` (use the project token already issued).
- Vercel Analytics: enabled (free tier).

---

## 10. Out of scope (do not build in v1)

- Login portal / account dashboard.
- In-browser app / web version.
- Multi-language (i18n).
- Dark/light toggle UI (we ship dark-only — the existing `data-theme` attribute is for the app, not the site).
- Animated SVG logo.
- Live chat / Intercom-style widget.
- Newsletter signup.

---

## 11. Definition of done

The agent should consider this spec satisfied when:

- [ ] All 6 routes render without console errors.
- [ ] Lighthouse mobile Performance ≥ 92, Accessibility = 100, Best Practices ≥ 95, SEO = 100.
- [ ] All interactive elements work via keyboard only.
- [ ] `/source` redirects to the correct GitHub repo.
- [ ] Pricing page checkout button is wired to a placeholder URL (`#TODO_LEMON_SQUEEZY_CHECKOUT`) — the real URL gets pasted in once Lemon Squeezy is verified.
- [ ] OG image renders correctly when the URL is shared on Twitter/Slack.
- [ ] No copy on the site references Cluely, Otter, Granola, Final Round, LockedIn, or any other competitor by name in the shipped version.
- [ ] No copy claims partnerships, certifications, or endorsements that aren't true (no fake testimonials, no fake user counts).
- [ ] Repo includes a `README.md` explaining how to run locally and deploy.

---

## 12. What the agent should ASK the user before starting

1. Brand accent color hex (default to a deep blue like `#4F7FF8` if not specified).
2. Final headline choice from §4.1 (or a fresh one).
3. Whether to ship Option A / B / C for the hero visual.
4. Email address for "support@glassnote.site" mailto link.
5. X / LinkedIn URLs for the footer (if user wants them).

If the user defers, take the defaults stated here.
