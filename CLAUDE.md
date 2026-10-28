# Pigment

Offline-first PWA that tells a painter which of *their own* paints to mix, in what amounts, and **how wrong the prediction will be**. React + Vite + TypeScript, IndexedDB, no backend.

**Medium status:** watercolor is primary and in build (spec below). Oil v1 is complete and **maintained, not extended**: keep its tests green and its outputs unchanged. Build oil features only when the owner un-parks oil.

## Where the decisions live

The specs are the source of truth. This file is the short list of what breaks if you forget it. When they disagree, the spec wins, and you flag the conflict to the owner instead of picking one.

- **Watercolor work** (engine, layers, swatch fits, lessons, mixing-order steps): `docs/pigment-watercolor-spec-v1.md`. It includes the gate sequence W0–W4: find the current gate before starting work.
- **Any change to an approved spec**: `docs/spec-amendments.md`. Record owner-approved deviations there; a spec that silently diverges from the code is a bug.
- **Lighting profiles / capture correction**: `docs/pigment-calibration-lighting-profiles-prd.md`.
- **Canvas Coach** (oil, engine built, UI gated): `docs/pigment-canvas-coach-spec-v1.5.md`, and `docs/phase-a-results.md` for why it's gated.
- **UI styling**: `src/prism/PRISM-README.md`.
- PRD v2 (the oil v1 spec) is not in the repo. The README's "Color engine" section is the best in-repo summary.

## The honesty contract

Every rule here protects one promise: the number the user sees is the real error.

- Every prediction carries its ΔE and its three-band confidence label. When the best result is poor, the UI says so in plain words (`verdictLabel` in `src/engine/search.ts`).
- Data provenance is explicit: `source` is `measured`, `manufacturer_published` or `estimated`, and confidence follows it. **Watercolor paints are measured-only.**
- Raw linear capture values are kept permanently beside corrected ones, so data can be reprocessed when the math improves.
- Gates are pass/fail records in `docs/`. A failed gate gets written up, any claim it supported is rolled back, and the options go to the owner. Gates are fixed before the test runs and stay fixed after the result.
- UI copy says "repeatable relative color" and "predicted dry". Absolute-accuracy language is off-limits.

## Architecture rules

- `src/engine/` is pure TypeScript and runs in Node: the CLI harnesses in `cli/` import it directly. Keep React, DOM, IndexedDB and browser APIs out of it.
- Color math happens in linear RGB. sRGB conversion happens once on input and once for display.
- Mixing models are Kubelka–Munk: single-constant for oil (`km.ts`), two-constant finite-film over paper for watercolor (`km2.ts`, built at gate W0 per spec §5). Predictions come from the physical model and nothing else; there's a regression test proving blue + yellow makes green.
- Medium is a field on `Paint` and the engine dispatches on it. Oil behavior is pinned by a regression test; a refactor that changes an oil output is a bug.
- Lighting profiles are data records, never an enum. Measured fits and gate test sets use **night session** captures only (amendment A3).
- Content (`content/guidance/`, `content/lessons/`) is versioned JSON covered by schema tests. Lessons and guidance are rule-triggered, never generated.
- Generated files are regenerated, never hand-edited: `src/data/catalog.json` comes from `npm run gen:catalog`.

## Rejected approaches

Each spec has a "Rejected approaches" section saying what to do instead. The short list, because agents drift back toward these:

RGB/hex averaging as a mix model · LLM guidance or any backend · generative image previews · inferring painting stage from a photo · whole-image analysis · stars, percentages or confidence meters · estimated watercolor data · predicting on a paper a paint wasn't fitted on · simulating granulation or wet-in-wet · a skip-calibration path · media beyond oil and watercolor.

If a task seems to need one of these, stop and ask the owner.

## UI: Prism

Prism is vendored in `src/prism/` (`tokens.css`, `glass.css`). Visual changes go into Prism as a token and a class, then get used. App code takes colors from tokens.

- The blob field in `App.tsx` (`.prism-blobs`) is what every `backdrop-filter` samples. Removing it turns every panel into flat gray.
- Glass saturation stays at or above ~160%. Three glass tiers, never four. At most one `.glass--iri` per view. Iridescent fills take dark ink.
- **Color-judgment surfaces** (any swatch being compared or judged) sit on opaque `--paper-*` ground with no glass and no iridescence in view. Saturated surroundings shift perceived color, which defeats the app's purpose.
- Engine-computed swatch colors are data, rendered from engine output.
- Fonts are self-hosted via `@fontsource-variable/*`. Fraunces is imported as `full.css` to keep its SOFT and WONK axes; the smaller import drops them.

## Gotchas

- **Pushing to `main` deploys publicly** (`.github/workflows/deploy-pages.yml`, GitHub Pages, public repo). Work on a branch and open a PR.
- `public/sw.js` caches by a version string. Bump `CACHE` when shipping changes to the shell, or installed PWAs keep serving the old build.
- The workflow runs `npm test` before deploying. A red test blocks deployment; fix it rather than skipping it.

## Working with the owner (Brenna)

- She is the product owner and the only v1 user. She paints watercolor, mostly at night.
- Make the call, say what you chose and why, and continue. Present options only when the choice is truly hers (scope, spend, anything a gate decides).
- Name conflicts and scope tension before building.
- Explain the *why* behind commands and architecture choices. She is learning the system as well as directing it.
- Physical tasks (swatching, photo shoots) are her bottleneck. Give her exact, numbered physical protocols, and keep asks for them small.
