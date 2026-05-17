# UI/UX Restyle Plan

Placeholder — fleshed out later. Not priority until backend + security land.

The premise: a fork that only changes the name and logo looks like a knockoff. A fork that changes the *brand identity layer* + *surface treatment layer* feels like a different product. Both are cheap; together they're the difference between "respun" and "redesigned".

---

## Brand identity layer (1–3 days)

- [ ] **Name + wordmark + monogram.** Replace `src/components/NativelyLogoMark.tsx` and `src/components/icon.png`.
- [ ] **Accent color.** Pick one. Define `brand-50..900` and `accent-*` in `tailwind.config.js`. Remove every raw `slate-*` / `gray-*` from `src/components/` and route through the new tokens.
- [ ] **Typeface.** Inter is fine but everyone uses it. Candidates with personality: Geist (UI), Söhne (premium), Instrument Serif (headings), JetBrains Mono (code/answer text). Update the Google Fonts link in `index.html` and Tailwind font family.

---

## Surface-treatment layer (3–7 days) — this is where forks usually fail to differentiate

- [ ] **Window chrome.** Corner radius, border thickness, shadow depth, glass/blur opacity. The overlay's silhouette is what users see most — change here registers strongly. **Where:** `electron/WindowHelper.ts` window options + the renderer overlay CSS.
- [ ] **Answer card typography rhythm.** Line-height, max-width, paragraph spacing. **Where:** `src/components/NativelyInterface.tsx` answer-render area.
- [ ] **Motion language.** Pick one ease (e.g. `cubic-bezier(0.16, 1, 0.3, 1)`) and a small set of durations (120 / 200 / 320 ms). Apply to suggestion-appear, typing indicator, card expand. **Where:** any `transition-*` or `framer-motion` props across components.
- [ ] **Icon set.** Wholesale replace. Currently uses `lucide-react`; alternatives are Tabler, Phosphor, or a custom set. One import change but visually obvious. **Where:** `src/components/**`.

---

## Do not bother restyling

- Settings panels and modal dialogs. Users see these once.
- The cropper, model selector, debug overlays.

---

## Add one differentiating UI element

- [ ] **"Live state" header in the overlay.** Explicit Listening / Thinking / Answering / Idle indicator. Makes the assistant feel responsive even before [LATENCY.md](LATENCY.md) work lands. Cheap; high-signal. **Where:** `src/components/NativelyInterface.tsx`.

---

## Budget

The whole rebrand pass is realistically **1 focused week**. Going deeper than that before you have users is over-investment.
