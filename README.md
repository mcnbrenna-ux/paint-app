# Pigment

*Given this target color and only the tubes I actually own, tell me which ones to squeeze out, in what proportion I can execute with a palette knife, and how wrong the result will be.*

Offline-first PWA for oil painters. React + Vite + TypeScript, IndexedDB, no backend. Built to the Pigment PRD v2.

## What it does (v1)

- **Tube inventory by pigment identity** — add tubes from an ~80-tube, 5-brand seed catalog (or as custom tubes). Every record carries Colour Index pigment codes, opacity, and a tinting-strength factor. Unknown-pigment tubes can be saved but are excluded from the mix engine and surfaced as "can't use this yet".
- **Target entry** — hex/picker (with OKLab readout) or tap-to-sample a 5×5 pixel average from an uploaded photo, with a persistent uncalibrated-color warning on image samples.
- **Mix search** — up to 5 ranked recipes as integer parts by volume totaling ≤ 12, each with a predicted swatch beside the target, ΔE, and a three-band confidence label. Out-of-gamut targets get the best attempt plus the single pigment class that would close the gap.
- **Recipe cards** — save offline; mixing order largest-volume-first.
- **Correction logging** — record how the physical mix differed (lighter/darker/warmer/cooler/duller/more saturated, slight/obvious), stored against the paint ids and exportable as JSON. v1 does not feed corrections back into the model.

## Color engine

Single-constant Kubelka–Munk, band-count agnostic (v1 runs 3 bands over linear RGB; a 31-band spectral upgrade changes the data, not the architecture):

- `K/S = (1−R)²/2R`, inverted as `R = 1 + K/S − √((K/S)² + 2·K/S)`
- Mixture K/S = effective-concentration-weighted sum, `c_eff_i = v_i·s_i / Σ v_j·s_j` (s = tinting strength, titanium white = 1.0)
- Prediction → OKLab; match quality is rescaled OKLab distance (×100) on a 0–100 band. **≤ 3** mix it · **3–6** usable start, adjust by eye · **> 6** not achievable with what you own.
- Search: combinations of 1–3 tubes (4 behind "search harder"), continuous optimum per combination via NNLS on the K/S hull, hull pruning, quantization to 12 parts with a radius-1 neighborhood, complexity penalties, dedup by pigment-code set.
- RGB/hex averaging as a prediction engine is forbidden; there's a regression test asserting blue + yellow makes green, not gray.

The 3-channel model is honest about its limits: confidence drops automatically for high-chroma organics (phthalos, quinacridones), dark high-chroma targets, and white-dominated tints — and is capped at "medium" while the seed data remains estimated rather than physically swatched.

## Repo layout

```
src/engine/     color, km, nnls, search, gamut, confidence — pure, UI-free, tested
src/data/       catalog.json (generated) + validation tests
src/db/         IndexedDB persistence
src/state/      app context (inventory, recipes, corrections, routing)
src/ui/         Inventory · Target · Results · RecipeDetail · Saved
cli/mix.mjs     Phase 0 harness: target hex + inventory JSON → ranked recipes
scripts/        gen-catalog.mjs (curated CSV) · fit-ks.mjs (swatch → K/S fit)
data/           catalog.csv — the versioned seed data file
```

## Commands

```sh
npm install
npm run dev            # local dev server
npm test               # engine + catalog tests (vitest)
npm run build          # type-check + production build (deployable to Netlify as-is)
npm run gen:catalog    # regenerate data/catalog.csv and refit src/data/catalog.json

# Phase 0 CLI
node cli/mix.mjs '#6a8f5a'                 # starter palette inventory
node cli/mix.mjs '#6a8f5a' inv.json        # your own inventory (ids or Paint objects)
node cli/mix.mjs '#6a8f5a' --all --harder  # whole catalog, allow 4-paint mixes
```

## Seed data status

Colour Index codes, opacity classes, and product names are curated from commonly published manufacturer data. The masstone/tint swatch hexes that K/S coefficients and tinting strengths are fitted from are **estimates** standing in for the physical swatch photography of Phase 1 — every paint is marked `source: "estimated"`, which is why the UI's confidence label tops out at "Decent estimate". Replacing the two hex columns in `data/catalog.csv` with measured swatch values (and flipping `source` to `measured`) upgrades the whole pipeline with no code changes.

## Lighting profiles (calibration PRD — shipped)

`docs/pigment-calibration-lighting-profiles-prd.md`. No calibration hardware: a dab of the user's own titanium white (or an optional 18% gray card) anchors every photo, and each lighting condition gets its own profile with its own captured swatch library. Pipeline per capture: linearize → median anchor → validate (clip/underexposed/occluded, non-technical re-shoot prompts) → per-channel von Kries → Lab(D65) → ΔE2000 against the active profile only. Profiles are data (create/rename/re-shoot/delete, two ship as defaults), raw linear values are retained for algorithm-revision reprocessing, artificial profiles prompt re-verification at 6 months or on bulb change, daylight profiles are flagged inherently variable. The active profile is visible on every screen that shows a color match. Honest scope, stated in the UI: repeatable relative color within a profile — not absolute color accuracy.

## Canvas Coach (v1.5 module — engine built, UI gated)

`docs/pigment-canvas-coach-spec-v1.5.md` specs the canvas-photo coaching module. Its own hard gates forbid UI before physical validation, so what ships today is everything buildable before those gates:

- `src/coach/lab.ts` — Lab(D50), Bradford adaptation, real CIEDE2000 (validated against the published Sharma test pairs).
- `src/coach/calibrate.ts` — Phase A capture calibration: 18% gray card (with an honest error floor — one patch can't detect a cast, so it never reports zero) and 24-patch ColorChecker (least-squares CCM + neutral-ramp LUTs, captureError = mean ΔE00, rejects > 6.0).
- `src/coach/extract.ts` — tap-region extraction with specular-outlier rejection and blown-highlight detection; captureError rides on every extracted color forever.
- `src/coach/errors.ts` — compounded error in quadrature (capture ⊕ KM model ⊕ 3-band fallback), always labeled an estimate.
- `src/coach/diagnose.ts` — Phase B diagnosis: declared mix forward pass vs actual, closed hypothesis list ranked from the Lab delta direction, "outside model" fallback.
- `src/coach/glaze.ts` — Phase C layer-over-substrate K-M composite (glaze / thin scumble / opaque) that transforms the user's pixels, never generates imagery.
- `src/coach/guidance.ts` + `content/guidance/*.json` — the rule tree with the six authored classical-workflow transitions, fat-over-lean as a blocking precondition, drying windows as ranges. Content is versioned and schema-tested.

Reference targets, cheapest first (see `docs/spec-amendments.md` A1): a thick matte patch of the user's own **titanium white** (±5.0 floor, $0), an **18% gray card** (±3.5 floor, ~$10), or a genuine **ColorChecker** (measured residual, ~$60). There is deliberately no skip-calibration path.

**Phase A harness:** `node cli/calibrate.mjs --selftest` (synthetic validation) or feed it shot JSONs of photographed reference cards. The gate to unlock any Coach UI: median captureError ≤ 4.0 ΔE00 across ≥ 20 photos under 3 lighting conditions — that requires a physical gray card / ColorChecker and real photographs.

## Validation to do (Phase 3, physical)

Hand-mix 15–20 predicted recipes, photograph beside targets, measure the spread; adjust the ΔE thresholds and confidence bands from data. The open risks in the PRD (§9) all have cheap physical tests — none of them are answerable in software.
