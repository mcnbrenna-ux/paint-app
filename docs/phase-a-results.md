# Phase A results — white-patch mode (A2 gate): FAIL

**Date:** 2026-08-09 · **Data:** 12 photos (4 window, 4 lamp, 4 combo), 5
patches each, pixel-sampled via the app's 5×5 tap sampling. Declared mixes,
predictions, raw hexes and scoring stored in the session records; summary here.

## Score

11/48 readings inside the compounded band (±6.2 dE00) = **23%**, gate ≥70%.
Held-out M3+M4: 3/24. Per the spec (§12) and amendment A2: **no Canvas Coach
UI is built.**

## What the data actually shows

1. **Within one lighting, the phone is highly repeatable.** Same-lighting
   shots agree to a few dE00 (combo M2 across four shots: #e29a5a/#de9457/
   #e1975a/#dd9458).
2. **Across lightings, white-patch correction fails.** The same physical
   patch, after correction, still moves up to 32 dE00 between window and lamp
   shots. Modern phone cameras apply scene-dependent white balance and local
   tone mapping; a single global gain from one white patch cannot undo it.
   This is the module's ranked risk #1 occurring as written.
3. **Dark values are crushed nonlinearly.** The M3 patch read #2d0000
   (near-black) in window shots vs #5a2413 under the lamp — a tone-curve
   effect no single-patch (white OR gray) linear correction can recover.
4. **The best-lit, most even setup (combo) nearly passed:** M1 ✓, M3 ✓,
   M2 borderline, only M4 clearly out.

## Consequences for the catalog

The v0.3.2 cerulean/sienna refits were fitted from captures now known to be
lighting-inconsistent. The directional corrections (cerulean much weaker and
less cyan than the original estimate) are supported by every lighting
condition and are kept; the `measured` source designation is rolled back to
`estimated` (confidence 0.5) because absolute values cannot be certified from
this capture pipeline.

## Options forward (owner's call)

- **A — Single-lighting protocol ($0, recommended):** constrain the Coach to
  "photograph under the same lighting your swatches were fitted under."
  Within-scene repeatability supports this. Requires re-authoring the gate
  (same-lighting test set) and refitting pigment data from that lighting.
- **B — ColorChecker (~$60):** the 24-patch CCM + neutral-ramp LUT pipeline
  (already implemented) is designed for exactly these failures. Plausible,
  unproven on this camera.
- **C — Park the module** ("dies honestly", spec §13.1). v1 is unaffected.
