# Spec amendments

Owner-approved deviations from the checked-in specs, recorded so the specs
stay honest about what actually shipped.

## A1 — Titanium-white reference target (Canvas Coach §4)

**Approved:** 2026-08-08, by the product owner in session, on budget grounds.

The Canvas Coach spec sets an 18% gray card as the minimum reference target
and forbids any skip-calibration path. This amendment adds a third, cheaper
reference below the gray card: a thick, matte patch of the user's own
titanium white paint, photographed in frame.

- Same single-patch math as the gray card (per-channel gain = white balance +
  exposure), referenced to the masstone of the user's actual white tube where
  known, else the catalog estimate.
- **Error floor ±5.0 ΔE00** (vs ±3.5 for the gray card, vs measured residual
  for the ColorChecker) — brand whites vary, and a single near-white patch
  detects even less about the camera's curve than a mid-gray does. The floor
  is carried on every downstream number, per the spec's error model.
- Rejects clipped patches (blown white is unrecoverable) and patches too dark
  to plausibly be titanium white.
- The no-skip rule is intact: there is still a physical reference in frame,
  or extraction refuses to run.

Upgrade path unchanged: gray card tightens the floor to 3.5; ColorChecker
replaces the floor with a measured residual.

## A2 — Adapted Phase A gate for white-patch mode (Canvas Coach §12)

**Approved:** 2026-08-08, follows from A1.

The original Phase A gate (median captureError ≤ 4.0 ΔE00) is unpassable by
construction in white-patch mode, whose captureError is floored at 5.0.
Because a floor is declared rather than measured, the white-mode gate tests
the thing that actually matters — end-to-end honesty of corrected readings:

- Test set: ≥ 20 photos under 3 lighting conditions of a board carrying the
  titanium-white reference patch plus 2–3 swatches of precisely declared
  mixes (see `docs/phase-a-shoot-instructions.md`).
- Per photo: calibrate on the white patch, extract each mix swatch, compare
  against the engine's forward-pass prediction for the declared recipe.
- **Gate: ≥ 70% of swatch readings across the set fall within the compounded
  error band** (capture floor ⊕ KM model ⊕ 3-band fallback, ≈ 6.2 ΔE00).
- Passing unlocks Coach capture/declare/diagnosis UI in white-patch mode
  only. The original ≤ 4.0 gate still governs gray-card/ColorChecker claims.

## A3 — Single-lighting capture protocol (Phase A option A)

**Approved:** 2026-10-27, by the product owner in session. Resolves the open
choice in `phase-a-results.md`.

- All measured color data (swatch fits for any medium, gate test sets) is
  captured under **one lighting profile: night session**. Phase A showed the
  phone is repeatable within one lighting and not correctable across
  lightings with a single patch; this protocol uses the half that works.
- Other profiles stay in the app (profiles are data) but no measured fit or
  gate result may mix captures across profiles.
- Canvas Coach (oil) remains gated. Its Phase A gate would need re-authoring
  as a same-lighting test set before it could re-run; that work is deferred
  with oil (A4).
- Option B (ColorChecker, ~$60) is the fallback if a same-lighting gate fails.

## A4 — Watercolor-first; oil maintained

**Approved:** 2026-10-27, by the product owner in session.

- Watercolor becomes the primary medium, specified in
  `pigment-watercolor-spec-v1.md`. The PRD v2 rejection of "multi-media
  support" is lifted **for watercolor only**; gouache, acrylic, colored
  pencil and pastel stay rejected.
- Oil is back-burnered: existing oil behavior is preserved (tests green,
  outputs pinned by a regression test before the medium refactor), and no
  new oil features are built. The one exception is mixing-order step text
  (watercolor spec §7), which is shared across media.
- Reference paper for v1: Arches 300 gsm cold press block. Watercolor paints
  enter the engine only as measured fits on that paper.
