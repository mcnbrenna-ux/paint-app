# Pigment — Canvas Coach Module Spec (v1.5 Addendum)

**Status:** Spec'd, gated. Companion to `pigment-prd-v2.md`. Do not begin implementation until Phase 0 (CLI engine validation) passes.

**One line:** Photograph the canvas, tell Pigment what stage you're at and what you mixed, get diagnosed color state + step-by-step guidance for the next layer + a physically-derived preview rendered on your own pixels.

---

## 1. Relationship to v1

This module reopens two features cut from v1 (instructional layer, image analysis) as a deliberate v1.5 decision. It does **not** reopen: multi-media support, backend infrastructure, whole-image compositional critique, or generative imagery. Those remain cut.

**Hard gates, in order:**
1. Phase 0 CLI harness validates mixing math (v1 PRD).
2. v1 core loop ships (target → ranked recipes).
3. Canvas Coach Phase A (capture + extraction) validates against physical swatches.
4. Only then: guidance engine + layer preview.

An agent implementing this spec must not build UI for any phase before the prior phase's validation gate passes.

## 2. Architecture decision: rule tree, no backend

Guidance is a deterministic rule tree over a finite stage taxonomy. **No LLM calls. No server.** All logic ships in the client bundle; all state lives in IndexedDB. Rationale: preserves offline-first architecture, keeps advice auditable and consistent, and avoids the cost/latency/privacy surface of shipping user photos to an API. If rule-tree guidance proves too shallow in user testing, revisit in v2 with evidence — do not preemptively "enrich" with generated text.

## 3. Stage taxonomy (closed enum)

```
stage ∈ {
  TONED_GROUND,      // imprimatura
  DRAWING_TRANSFER,  // no color guidance; skip color pipeline
  UNDERPAINTING,     // monochrome or dead-color layer
  BLOCK_IN,          // first opaque color masses
  FIRST_PAINTING,    // developed forms, mid-detail
  GLAZING,           // transparent layers over dry paint
  SCUMBLING,         // broken opaque/semi-opaque over dry paint
  DETAILS_FINAL      // highlights, accents, edges
}
```

This enum is closed. Do not add stages, do not accept freeform stage input, do not infer stage from the photo. The user declares the stage. Stage inference from imagery is explicitly out of scope (see §11).

## 4. Capture protocol (non-negotiable)

Uncalibrated capture invalidates every downstream number. The capture flow enforces:

- **Reference target required.** Minimum: neutral gray card (18%) in frame. Preferred: 24-patch ColorChecker. No target detected → extraction refuses to run. There is no "skip calibration" path.
- **Raked-angle guidance.** On-screen overlay instructs shooting ~30–45° off-normal under diffuse light to suppress specular highlights on wet paint. Detect blown-highlight clusters in the sampled region; if present, reject with re-shoot instructions.
- **Camera constraints.** Request the least-processed capture the platform allows (disable flash; where the web API permits, lock exposure/WB during capture). Accept that PWA camera access limits control — this is why the reference target carries the calibration load, not the camera settings.

### Calibration pipeline
1. Locate target patches (gray card: single-patch white balance + exposure normalization; ColorChecker: fit 3×3 color correction matrix + per-channel 1D LUT via least squares against known patch Lab values).
2. Apply correction to the full frame.
3. Compute residual: mean ΔE00 between corrected patches and reference values. Store as `captureError`.
4. If `captureError > 6.0` ΔE00 → reject capture, explain likely causes (mixed lighting, glare, dirty card).

## 5. Color extraction

- User taps regions of interest on the corrected image; no automatic full-image segmentation.
- Per tap: sample a small radius (default 9px at capture resolution), reject specular outliers (top-decile luminance within sample), median the remainder, convert to Lab (D50).
- Each extracted color carries `captureError` as metadata forever. It never gets laundered off.

## 6. Error model (compounding, reported, never hidden)

```
reportedError = f(captureError, kmModelError, spectralFallbackError)
```

Combine in quadrature (√Σe²) as the default estimator and label it as an estimate. Every recipe or diagnosis derived from a photographed color displays the compounded figure, not the engine-only figure. Inline gap flag (same convention as v1 PRD): single-constant K-M on 3-channel data is already an approximation; photo capture stacks a second approximation on top. The UI says so in plain language. No confidence stars, no green checkmarks, no vibes.

## 7. Diagnosis (what's on the canvas)

Input: extracted target color(s) + user's declared mix (pigments + medium, selected from their existing palette inventory) + declared stage.

Output per sampled region:
- Predicted color of the declared mix (engine forward pass) vs. extracted actual color, with ΔE00 and the compounded error band.
- If |predicted − actual| exceeds the error band: ranked hypotheses from a closed list (proportion drift, medium dilution shifting value, insufficient mixing, substrate show-through on thin passages). These are rule-derived from the direction of the Lab delta — e.g., actual lighter + less chromatic than predicted → dilution/substrate hypotheses rank first.
- No hypothesis outside the closed list. If the delta pattern matches nothing, say "outside model — likely capture or declaration error" and stop.

## 8. Guidance engine (rule tree)

### Data model
```
GuidanceRule {
  id, fromStage, toStage,
  preconditions: [PredicateRef],   // e.g., layerDrynessDeclared, valueRangeCheck
  steps: [GuidanceStep],
  cautions: [CautionRef]           // fat-over-lean, drying-window, etc.
}
GuidanceStep {
  ordinal, instruction,            // terse imperative text
  mixTargets: [ColorTarget]?,      // feeds the v1 recipe engine
  previewTransform: LayerSpec?     // feeds §9
}
```

- Rules are static content, authored and versioned in the repo (`/content/guidance/*.json`), reviewed like code.
- Fat-over-lean is enforced as a hard precondition: each stage carries a medium-fat index; a rule whose target layer is leaner than the declared current layer emits a blocking caution, not a suggestion.
- Where a step needs a mix ("warm the shadow masses toward X"), the step emits a `ColorTarget` and the **existing v1 engine** produces the recipe from the user's palette. The guidance layer never invents its own color math.
- Drying windows are stated as ranges with the standard caveat (pigment, thickness, ambient); never a single number.

### Authoring scope for v1.5
Author the transitions that cover the classical indirect workflow end-to-end: TONED_GROUND→UNDERPAINTING, UNDERPAINTING→BLOCK_IN, BLOCK_IN→FIRST_PAINTING, FIRST_PAINTING→GLAZING, FIRST_PAINTING→SCUMBLING, GLAZING→DETAILS_FINAL. Six transitions, done well. Do not scaffold empty rules for every stage pair.

## 9. Layer preview (the differentiator)

**Never generate imagery. Transform the user's pixels.**

A proposed next layer is a `LayerSpec { recipe, thicknessClass ∈ {glaze, thinScumble, opaque}, mediumLoad }`. Preview pipeline:

1. Take the user's corrected photo region as substrate.
2. For `glaze` / `thinScumble`: apply the single-constant K-M layer-over-substrate composite per pixel (layer K/S from the recipe via the v1 engine; substrate reflectance approximated from corrected pixel values). This is exactly the physics K-M was built for — it is the strongest use of the model in the entire product.
3. For `opaque`: preview is the flat predicted mix color over the region at declared coverage; no texture synthesis.
4. Render side-by-side: current ↔ predicted, with the compounded error band printed on the preview. Label: "Physical prediction from your photo — not a photograph of a finished painting."

Edge handling: preview operates only on user-tapped regions or user-lassoed masks. No auto-segmentation of the composition.

## 10. UX flow

1. **Capture screen.** Live overlay: target-card detection status, angle hint, glare warning. Shutter disabled until card detected. Error state: "No reference card found — extraction can't be honest without one" + link to what a gray card is and where to get one (~$10).
2. **Declare screen.** Stage picker (closed enum), mix declaration (multi-select from palette inventory + medium + rough proportion via integer parts, consistent with v1), tap-to-sample on corrected image.
3. **Diagnosis screen.** Per-region predicted vs. actual with ΔE and hypotheses (§7).
4. **Next-step screen.** Rule-tree steps in order; each mix step expands to a v1 recipe card; each preview-eligible step shows the §9 side-by-side.
5. **Empty states.** No palette defined → block with redirect to palette setup. Stage = DRAWING_TRANSFER → skip color pipeline entirely, show transfer-stage guidance only.

## 11. Rejected approaches (do not implement)

- **Generative mockups** (diffusion/img2img "here's how it could look"). Produces someone else's painting; unfalsifiable; violates the honesty contract. The K-M pixel transform replaces it.
- **Uncalibrated capture with a "results may vary" disclaimer.** A disclaimer is not calibration. Refuse instead.
- **Automatic stage inference from the photo.** Classifier confidence would masquerade as understanding; the user knows their stage.
- **LLM-generated guidance text.** Non-deterministic advice with a backend dependency. Rule tree only.
- **Full-image analysis / composition critique.** Remains cut from the original PRD. Region taps only.
- **Confidence meters, stars, percentage certainty.** Compounded ΔE bands only, per v1 convention.

## 12. Build sequence

- **Phase A — Capture & calibration.** CLI-first: run the calibration pipeline on test photos of physical swatches with known mixes; gate = median `captureError` ≤ 4.0 ΔE00 across a 20-photo test set under 3 lighting conditions. No UI until passed.
- **Phase B — Diagnosis.** Wire extraction into the validated v1 engine; validate hypothesis ranking against deliberately-perturbed physical mixes (known over-dilution, known proportion drift).
- **Phase C — Layer preview.** Validate K-M glaze composite against physical glazes over photographed substrates; gate = predicted vs. photographed-result ΔE within the stated error band on ≥70% of a 15-sample glaze set.
- **Phase D — Guidance content + UI.** Author the six transitions; assemble screens.

## 13. Open risks (ranked)

1. **PWA camera processing.** Browser-applied tone mapping may exceed what card calibration can correct. Cheap validation: Phase A test set, week one. If median error can't hit the gate, this module needs native capture or dies honestly.
2. **Substrate reflectance from RGB.** Approximating substrate K/S from corrected pixels is the weakest link in the preview math. Flag inline; validate in Phase C.
3. **Wet-paint gloss.** Raked-angle protocol may not fully suppress specular on heavy impasto. Mitigation: outlier rejection (§5) + reject-and-reshoot; residual risk accepted and disclosed.
4. **Guidance authoring load.** Six transitions of genuinely good content is days of expert work, not hours. Budget it; thin content here is worse than shipping without the module.
5. **User friction: the card requirement.** Some users will bounce off "buy a gray card." Accepted trade — the alternative is a product that lies.
