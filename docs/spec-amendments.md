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
