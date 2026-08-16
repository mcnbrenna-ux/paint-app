# Pigment — PRD Section: Color Calibration & Lighting Profiles

**Status:** Locked. Do not substitute an alternative approach without flagging it first.

---

## 1. Problem

Pigment compares a photographed color against a stored swatch library. Phone cameras apply automatic white balance and automatic exposure per shot, so the same pigment under the same lamp can be captured with meaningfully different RGB values depending on what else is in frame. Without correction, every comparison is noise.

The industry solution is a calibrated color reference target (e.g. an X-Rite/Calibrite passport, ~$60). We are deliberately not requiring one.

## 2. Locked decisions

1. **No calibration hardware is required.** The app must be fully functional with a phone camera and the user's existing paints.
2. **Lighting profiles, not universal color science.** The user paints in a small number of repeatable lighting conditions. Each condition gets its own captured swatch library.
3. **Every photo carries a white anchor.** A dab of the user's own titanium white (or equivalent opaque white) is kept on the palette and must appear in every capture. All normalization is computed against it.
4. **Profiles are data, not enum values.** The user can create, rename, re-shoot, and delete profiles. Two ship as defaults; the count is not fixed.

### Honest scope limitation — state this in the UI

This system delivers **repeatable relative color within a profile**, not colorimetrically accurate absolute color. Titanium white is a paint, not a spectrally neutral reference; it has a slight brand-dependent cast. That is acceptable because every comparison happens between images captured through the same pipeline, in the same profile, against the same anchor. Do not market or label this as absolute color accuracy. Users wanting absolute accuracy should be offered an optional path: shoot the anchor as a photographic 18% gray card instead of white paint.

## 3. Data model

```
LightingProfile
  id: uuid
  name: string                    // "Night — desk lamp", "Weekend afternoon"
  createdAt: timestamp
  lastVerifiedAt: timestamp
  anchorReference: {              // linear RGB of the white anchor in this profile
    r: float, g: float, b: float  // measured at profile creation
  }
  swatches: [SwatchCapture]
  notes: string                   // user-editable: "overhead off, lamp at 4 o'clock"

SwatchCapture
  pigmentId: string               // FK to pigment/tube record
  correctedLab: { L: float, a: float, b: float }
  rawLinearRgb: { r, g, b }       // retained for re-processing if algorithm changes
  capturedAt: timestamp
```

Retain `rawLinearRgb` permanently. If the correction algorithm is ever revised, the entire library can be reprocessed without asking the user to re-shoot anything.

## 4. Profile creation flow

1. User names the profile and is prompted to shoot in the position they actually paint in.
2. User places the white anchor on the palette. App shows a framing guide with a fixed region for the anchor.
3. App locks camera exposure and white balance (see §6) before the first frame and holds the lock for the entire session.
4. User photographs swatches. Batch capture is preferred over one-at-a-time.
5. App measures the anchor region, stores `anchorReference`, computes and stores corrected Lab for every swatch.
6. Profile is marked verified.

## 5. Runtime correction algorithm

For every captured image, in this order:

1. **Linearize.** Convert sRGB pixel values to linear RGB by removing the sRGB transfer function. All arithmetic happens in linear space. Averaging or scaling gamma-encoded values is incorrect and will produce wrong results.
2. **Sample the anchor.** Take the median (not mean) of pixels inside the anchor region. Median rejects specular highlights and stray bristle marks.
3. **Validate.** Reject the frame and prompt a re-shoot if:
   - any anchor channel is clipped (≥ 0.98 in normalized linear terms) — the correction is unrecoverable
   - the anchor is underexposed (all channels < 0.15)
   - the anchor region is missing or has variance above threshold (something is occluding it)
4. **Apply per-channel von Kries scaling.** Compute gain per channel so the measured anchor maps to the profile's `anchorReference`:
   `gain_c = anchorReference_c / measured_c` for c in {r, g, b}
   Multiply every pixel by its channel gain. This corrects white balance drift and exposure drift in one operation.
5. **Convert to CIELAB** under D65.
6. **Compare** against the active profile's swatch library using **ΔE2000**. Do not use ΔE76 — it badly misjudges saturated colors, which is most of a paint library.

Only compare against swatches from the currently active profile. Cross-profile comparison is disallowed at the query layer, not just discouraged in the UI.

## 6. Camera requirements

- Lock AE and AWB for the duration of a capture session; re-lock if the session is backgrounded.
- Disable HDR, disable flash, disable night mode, disable any scene-based enhancement.
- Capture the highest bit depth available. If RAW is accessible on the platform, prefer it; fall back to JPEG.
- Do not apply any app-side saturation, contrast, or sharpening before correction.

## 7. Session selection UX

On entering a comparison or guidance flow, the user picks the active profile. Default to the most-used profile rather than the most recent, and make the choice a single tap with the profile's name visible on every subsequent screen. A user comparing against the wrong profile is the single most likely source of bad output, so the active profile must never be ambiguous.

## 8. Profile drift and re-verification

Artificial light is stable; daylight is not. Handle these differently.

- **Artificial-light profiles:** prompt re-verification after 6 months, or immediately if the user records a bulb or fixture change. Offer a one-tap "re-shoot anchor only" that updates `anchorReference` without re-shooting the full swatch library.
- **Daylight profiles:** flag as inherently variable in the UI. Window light shifts by hour, season, and cloud cover, and the anchor correction absorbs some but not all of that — a change in the light's spectral character is not fully correctable by per-channel gain. Daylight results should carry a lower confidence indicator, and the app should suggest an artificial-light session when precision matters.

## 9. Out of scope for v1

- Bradford or CAT02 chromatic adaptation (per-channel von Kries is sufficient at this precision)
- Spectral reflectance estimation
- Cross-profile color translation
- Automatic ambient light detection via sensor

## 10. Acceptance criteria

1. The same pigment, photographed five times in one profile with deliberately varied framing and background, produces corrected Lab values within ΔE2000 < 2.0 of each other.
2. A frame with a clipped anchor is rejected with a clear, non-technical re-shoot prompt.
3. Deleting a profile deletes its swatch captures and never orphans them into another profile.
4. Changing the algorithm and reprocessing from `rawLinearRgb` requires no user re-capture.
5. The active profile name is visible on every screen that displays a color match.

---

## Implementation notes (recorded deviations & platform realities)

- `SwatchCapture` additionally stores `rawAnchorLinearRgb` (the anchor as
  measured in the same frame) — without it, AC4's reprocess-from-raw is
  impossible because gains are per-frame, not per-profile.
- `LightingProfile` additionally stores `kind` (artificial/daylight, needed by
  §8), `anchorKind` (white paint / gray card, §2), and `useCount` (§7
  most-used default).
- §6 on the web platform: AE/AWB locking is applied via
  `MediaStreamTrack.applyConstraints` where the browser supports it, re-applied
  on visibility change, and its status (locked / partial / unsupported) is
  shown to the user. HDR/night-mode are OS-level and covered by an on-screen
  instruction. Bit depth ceiling is the 8-bit canvas; RAW is unreachable from
  a PWA. The anchor carries the correction load in all cases — which is the
  design's central premise.
- §5.4 "multiply every pixel": correction is applied to every *sampled* pixel
  (all color that flows downstream); the displayed photo is left as shot.
