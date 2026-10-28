# Pigment — Watercolor Module Spec (v1)

**Status:** locked by the product owner, 2026-10-27. Amendments A3 (single-lighting capture) and A4 (watercolor-first) in `spec-amendments.md` record the decisions this spec builds on.
**Relationship to existing specs:** the oil v1 engine, lighting profiles and Canvas Coach engine stay as built. Oil is **maintained, not extended**: its tests stay green and it receives no new features. Everything below is new work.

---

## 1. Why this exists

The owner paints mostly watercolor now. The founding failure: a yellow leaf over a violet underpainting came out dull and gray. A complementary underpainting is a valid oil technique because opaque, broken top layers let the underlayer show *beside* them, and the eye mixes the two. In watercolor every layer is a transparent filter over the paper. Light passes through the yellow, then the violet, bounces off the paper and returns through both. The two layers' absorptions combine, and complements absorb nearly everything. **Glazing complements in watercolor is mixing them.**

Generic color-theory advice is medium-blind. The product promise is advice that is right *for the medium in hand*, computed from the user's own paints and paper, with the error printed.

**v1 user:** the owner. Single paper, her own paints. Selling is a later decision (§12). Nothing here builds for unknown customers.

---

## 2. Scope

**In v1**

1. **Watercolor mixing:** target color → ranked recipes from owned watercolor paints, predicted *dry* swatch, ΔE, confidence band.
2. **Mixing-order steps** on every recipe, for oil **and** watercolor (§7). This is the only feature that touches oil, and it's deterministic text generated from existing data.
3. **Layer check:** the user enters the layers they intend to paint (wet-on-dry, each fully dry before the next). The app shows the predicted swatch after each layer, the final result, ΔE to an optional target, and rule-triggered lessons. This mode would have caught the yellow leaf.
4. **Layer plan:** target color → the direct single-wash recipe, plus the best two-layer glaze plans, each with a per-layer predicted swatch and rule-triggered lessons.
5. **Swatch-fit pipeline** that turns photographed swatch cards into watercolor pigment data (§5).

**Out of v1** (named so they aren't added "while we're in there")

- Wet-in-wet, blooms, backruns, lifting, granulation *texture*, salt or other effects. The model is wet-on-dry, flat films only. Granulating and staining are stored as labels and used by lesson rules. They are never simulated.
- Any paper besides the reference paper (§4).
- Photo-based watercolor coaching. Canvas Coach stays oil and stays gated (A3).
- Gouache, acrylic, colored pencil, pastel.
- An estimated or seeded watercolor catalog (§5.4).
- Accounts, sync, payments, licensing.

---

## 3. Architecture: medium as a pluggable model

`Paint.medium` already exists as the literal `'oil'`. Widen it to `'oil' | 'watercolor'` and dispatch on it.

```
src/engine/
  km.ts            existing single-constant KM (oil). Unchanged.
  km2.ts           NEW: two-constant KM + finite-layer-over-substrate (watercolor)
  medium.ts        NEW: MediumModel interface + oil adapter (wraps km.ts) + watercolor adapter
  search.ts        dispatches through MediumModel; oil behavior byte-identical
  layers.ts        NEW: layer stack forward pass + 2-layer plan search (watercolor)
  steps.ts         NEW: mixing-order step generator (both media)
src/data/watercolor/   fitted catalog JSON (generated, never hand-edited)
data/watercolor/       palette.csv (owner's paints) · swatch captures · fit outputs
content/lessons/watercolor/*.json   lesson rules (schema-tested, like content/guidance)
cli/
  mix.mjs          gains --medium watercolor
  layers.mjs       NEW: check and plan modes
  fit-watercolor.mjs  NEW: swatch captures → fitted catalog
```

`engine/` stays pure: no React, DOM, IndexedDB or browser APIs, runnable in Node by the CLI. Same rule as today.

```ts
interface MediumModel {
  medium: 'oil' | 'watercolor'
  /** Predicted reflectance (linear, per band) of a mix as it appears dry on the reference substrate. */
  predictMix(components: { paint: Paint; parts: number }[], strength?: WashStrength): Float64Array
}
```

The oil adapter must produce exactly today's outputs. A regression test pins a set of current `cli/mix.mjs` results before the refactor and asserts they're unchanged after it.

---

## 4. Reference paper

**Arches 300 gsm (140 lb) cold press, block.** One paper in v1.

The paper *is* the white. Every watercolor prediction is a film over this paper's measured reflectance, `Rg`. The paper gets a record:

```ts
interface Paper {
  id: string              // 'arches-300-cp-block'
  name: string
  reflectance: number[]   // per band, measured bare-paper patch, linear
  source: 'measured'
  profile_id: string      // lighting profile it was measured under
}
```

Every watercolor paint record carries the `paper_id` it was fitted on. The engine refuses to predict a paint on a paper it wasn't fitted on. Refusing is honest. Silently reusing data fitted on another paper would not be.

---

## 5. Watercolor color engine

### 5.1 Model: two-constant Kubelka–Munk, finite films

Watercolor is a thin transparent film over a substrate. That calls for the general Kubelka solution with separate absorption `K` and scattering `S`, and for film thickness. Per band, a film with `KX`, `SX` (coefficient × thickness, which is what gets fitted) over a background of reflectance `Rg`:

```
a = 1 + K/S
b = sqrt(a² − 1)
R = (1 − Rg·(a − b·coth(b·SX))) / (a − Rg + b·coth(b·SX))
```

Required invariants, each a unit test:

- `SX → ∞` gives `R → R∞ = a − b` (an infinitely thick film hides its background).
- `SX → 0` gives `R → Rg` (no film, only paper).
- Raising `KX` never raises `R` in any band.
- With `Rg` = paper, the output is never brighter than the paper in any band.

This replaces the `ALPHA` coverage heuristic in `src/coach/glaze.ts` **for watercolor only**. That heuristic was a stand-in for the missing thickness term in single-constant oil. Watercolor has a real thickness term, so it doesn't need one. Leave `glaze.ts` as is for oil.

### 5.2 Mixing within one wash

Mix by pigment-load fraction `f_i = parts_i / Σparts`:

```
KX_mix = Σ f_i · KX_i(strength)
SX_mix = Σ f_i · SX_i(strength)
```

This assumes equal total pigment load per strength level. That's a modeling assumption, validated in Gate W2, and flagged in code where it's applied.

### 5.3 Recipe units

- **Parts = brush-loads**: same brush, same pick-up, into the mixing well. Integer parts, at most 6 total (fewer than oil's 12, because a brush-load is coarser than a knife portion). Sorting, reduction and the dedup rules carry over from oil.
- **Strength = `pale | medium | strong`**, mapped to each paint's fitted ladder (§5.4).
- The prediction is the **dry** color. Watercolor dries lighter and duller than it looks wet. The UI says "predicted dry" on every watercolor swatch.
- Every watercolor recipe ends with a test-swatch step on a scrap of the same paper (§7). The units are coarse, and the honest response is a check step, not false precision.

### 5.4 Data: measured only, by pigment code

Watercolor paints enter the engine **only** with `source: 'measured'`, fitted from the owner's swatches. There is no estimated seed catalog. With two constants per band plus a strength ladder, an estimated seed would be invention presented as data.

`data/watercolor/palette.csv`, filled in by the owner:

```
brand,line,product_name,pigment_ids,staining,granulating,notes
Winsor & Newton,Professional,<name>,<CI codes from label>,<yes/no/unknown>,<yes/no/unknown>,
```

Staining and granulating come from the manufacturer's label or chart, or are marked `unknown`. Never infer them.

Organizing by Colour Index code (as the oil catalog already does) means another brand's PB29 is a new swatch card later, not new code.

**Starter palette:** the owner's 12 most-used W&N paints. The list isn't supplied yet; the fit pipeline runs on however many rows exist.

### 5.5 Swatch protocol (Gate W1 input)

Per paint, one card on the reference paper:

1. Before painting, put a stripe of **carbon-black waterproof ink** (India ink) across the card and let it dry fully.
2. Paint three bands across the stripe, `strong`, `medium` and `pale`, each a single even wash. Keep the brush and the water-to-paint method consistent across all paints and record it in the session notes.
3. Leave a **bare-paper patch** and a **bare-ink patch** on every card.
4. Dry fully (at least 24 h). Photograph under the **night session profile only** (A3), card flat, no glare, same position every time.
5. Shoot each card **three times**, re-placing it between shots. The spread between the three shots is the measured capture floor for W1.

**Fit:** per band, per strength level, two observations of the same film are available: over paper (`Rg` = bare-paper patch) and over ink (`Rg` = bare-ink patch). Solve `KX`, `SX` numerically through the §5.1 forward model. Two equations and two unknowns, so the fit is exact per band. Verify by round-trip: the fitted film over paper reproduces the photographed band.

**Anchor:** in watercolor mode, the white anchor for capture correction is the **bare-paper patch on the same block**. It's in every shot anyway, and paper-relative color is exactly what the predictions are about. Honest scope, same as the lighting PRD: repeatable relative color within one profile, on one paper.

### 5.6 Confidence

Reuse `confidence.ts`'s approach with watercolor-specific inputs:

- The high-chroma organics rule applies unchanged. Watercolor palettes lean on phthalos and quinacridones, where 3-band KM is weakest. Expect `medium` often, and show it.
- Confidence is capped at `medium` until Gate W2 passes.
- Confidence drops one band for any `granulating: yes` paint. The flat-film model can't represent granulation.

Match quality uses the same rescaled OKLab ΔE and verdict thresholds as oil (`search.ts`) until W2 data says otherwise. One metric across media keeps the UI consistent.

---

## 6. Layers (the main feature)

### 6.1 Forward pass (layer check)

A layer stack is an ordered list of `{ recipe, strength }`, painted wet-on-dry, each layer fully dry before the next. Computing it:

```
R_0 = paper.reflectance
R_n = film(KX_mix_n, SX_mix_n) over background R_(n−1)      // §5.1, per band
```

Output per layer: predicted dry swatch, OKLab and ΔE to the target if one is given. Up to 4 layers in check mode.

### 6.2 Plan search (layer plan)

Given a target, return:

1. The best **direct** single-wash recipe (§5).
2. Up to 3 **two-layer** plans. Each layer has 1–2 paints and a strength, so the search space is `(paints choose ≤2) × part splits × 3 strengths` per layer, squared. Prune with the same hull and residual approach `search.ts` uses, and dedup by pigment set per layer.

Rank by final ΔE with a complexity penalty, so a two-layer plan has to beat the direct recipe by a clear margin to be listed above it. Reuse oil's `EXTRA_PAINT_PENALTY` scale as the starting point. Show the direct recipe even when a plan wins. Sometimes the right advice is "don't glaze, just mix it."

### 6.3 Lessons (rule-triggered, deterministic)

Lessons attach to check and plan outputs when their trigger fires. They follow the guidance rule-tree conventions: JSON content in `content/lessons/watercolor/`, versioned and schema-tested, with no generated text.

Initial rule ids and triggers. The copy is drafted, then approved by the owner before it ships. Thin lesson copy is worse than no lesson.

| id | Trigger (computed) | Teaches |
|---|---|---|
| `complement-glaze-dulls` | final chroma is below both layers' solo-over-paper chroma by more than `DULL_DROP` (provisional OKLab ΔC 0.04, tuned in W3) | glazing complements = mixing them; put the complement only where you want it grayed (shadows) |
| `warm-under-for-glow` | target is a high-chroma yellow or orange and the plan's underlayer is analogous and warmer | why a warm underlayer makes a glow and a complementary one makes mud |
| `dries-lighter` | always on the first watercolor recipe a session shows | the wet/dry shift, and why to test on scrap |
| `staining-goes-first` | a plan's top layer is `staining: no` over a staining underlayer | the order in which lifting and re-wetting risk falls |
| `granulation-not-modeled` | any `granulating: yes` paint in the recipe | what the prediction can't show |

Thresholds are named constants in one file, each with a comment pointing to the gate that tunes it.

---

## 7. Mixing-order steps (both media)

Generated deterministically from tinting strength, parts and medium. No content files and no authored prose per recipe.

**Watercolor:**

1. Water in the well first.
2. Add the paint with the **lowest tinting strength** first, at its full part count.
3. Add stronger paints **one brush-load at a time**, mixing between loads. The last-added paint is the one most likely to overshoot.
4. Test on a scrap of the reference paper and let it dry before judging. Wet always reads darker.

**Oil** (replaces today's "largest-volume-first" ordering *text only*; the recipe data is unchanged):

1. Lay out the weakest tinter first.
2. Add the strongest tinter in small increments. A phthalo or quinacridone can overrun a pile in one knife-tip.
3. Add white last when the recipe is white-dominated, because tinting strength error dominates there (see `confidence.ts` failure mode c).

The wording lives in `steps.ts` constants, one source of truth, covered by a snapshot test.

---

## 8. Rejected approaches (do not implement)

| Rejected | Why | Do instead |
|---|---|---|
| Reusing single-constant oil KM for watercolor | It has no thickness or substrate term and can't represent a transparent film over paper | §5.1 two-constant finite film |
| Coverage-alpha blending (`glaze.ts` `ALPHA`) for watercolor layers | A heuristic standing in for a thickness term watercolor actually has | §6.1 forward pass |
| Estimated watercolor seed data | Two constants × bands × strength ladder, guessed, is fiction | §5.4 measured only |
| Predicting on a paper the paint wasn't fitted on | Paper is the white; a mismatched `Rg` invalidates every number | refuse with a clear message |
| Wet-color predictions | Painters judge dry; wet is darker and more saturated | predict dry, label it |
| Percentages or ml for watercolor amounts | Unexecutable with pans and brushes | brush-load parts + strength ladder + test-swatch step |
| Simulating granulation, blooms, wet-in-wet | Outside the flat-film model; any output would be decoration | label it via a lesson rule |
| LLM-written lessons | Nondeterministic, needs a backend | §6.3 rule-triggered JSON |
| Medium-blind color theory | The founding bug | lessons are medium-scoped files |
| Stars, percentages, confidence meters | Hide the error | ΔE + three-band label, as v1 |

---

## 9. Gates and build sequence

CLI first, UI last. Each gate is a written result in `docs/`, in the format of `phase-a-results.md`, with the verdict stated plainly.

- **W0: Engine math (software only).** `km2.ts` and `layers.ts` with the §5.1 invariants, the oil regression pin (§3) and `steps.ts`. **Gate:** all tests green, oil outputs byte-identical. Mixing-order steps for oil may ship in the UI at W0, since they're text over existing data.
- **W1: Swatch and fit.** The owner paints the cards (§5.5) and `cli/fit-watercolor.mjs` fits them. **Gate:** (a) the three-shot capture spread gives a measured capture floor; (b) round-trip residual ≤ that floor on ≥ 90% of bands. *Cost: about 10 min of painting per paint plus one photo session.*
- **W2: Mix validation.** 10 predicted watercolor mixes painted physically and photographed under night session. **Gate:** ≥ 70% within the compounded band (capture floor ⊕ model term), same rule as amendment A2. **Unlocks:** watercolor recipe UI, confidence allowed above `medium`.
- **W3: Glaze validation.** 10 two-layer glazes, which **must include yellow over violet** (the founding case) and one warm-under-yellow pair. **Gate:** ≥ 70% within the band. **Unlocks:** layer check and layer plan UI, and tunes `DULL_DROP`.
- **W4: UI.** Medium switch (watercolor default, oil selectable), layer check screen, layer plan screen. Prism rules apply, including the neutral surround rule for every swatch.

If W2 or W3 fails, record it the way Phase A was recorded, roll back any claim it would have supported, and bring the options to the owner. Don't adjust the gate to pass.

---

## 10. UX notes (W4)

- Watercolor is the default medium. Oil stays one tap away, not hidden.
- Swatches render as stacked strips: paper → after layer 1 → after layer 2. Each is labeled "predicted dry", with ΔE beside it.
- The active lighting profile and the paper name are visible on every screen showing a prediction, as the lighting PRD already requires for profiles.
- When a paint in the inventory has no fit yet, it's listed as "needs a swatch card". It's never silently excluded.

---

## 11. Open risks (ranked)

1. **Brush-load repeatability.** Owner-made strength levels may vary more between sessions than the model's error. W1's consistent-method notes and W2's spread will show it. Mitigation if it fails: express strength as a measured water ratio (drops per load).
2. **3-band limits on modern organics.** Expect the largest misses on phthalo and quinacridone glazes. The fix is the spectral upgrade the engine is already band-agnostic for. Not v1.
3. **Ink stripe reflectance.** Very dark backgrounds sit near the reflectance clamp (`R_MIN` in `km.ts`). If the fit is unstable over ink, fall back to the paper-only fit with a stated loss of confidence.
4. **Equal-load mixing assumption (§5.2).** W2 tests it directly.
5. **Owner time.** Swatching is the bottleneck, not code. Twelve paints is about a two-hour session.

---

## 12. Later (not v1, recorded so it isn't lost)

- **Selling:** buyers bring their own paints and papers. That means a per-user swatch-fit flow in the app, multiple papers, and a decision on licensing and payments under no-backend. Revisit after W3.
- Other papers (hot press, other brands), as one more `Paper` record and a re-fit.
- Photo-based watercolor coaching, once a capture path passes a gate.
- Oil feature work resumes when the owner un-parks it.
