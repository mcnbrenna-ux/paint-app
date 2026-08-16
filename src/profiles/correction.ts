// Lighting-profile correction pipeline (calibration PRD §5), in order:
// linearize → median anchor → validate → per-channel von Kries scaling →
// CIELAB (D65) → ΔE2000 against the active profile only.
//
// This delivers repeatable RELATIVE color within a profile, not absolute
// colorimetric accuracy (§2) — the anchor is the user's own white paint, and
// every comparison happens through the same pipeline against the same anchor.

import { deltaE00, linearRgbToLabD65, type Lab } from '../coach/lab.ts'
import { srgbChannelToLinear } from '../engine/color.ts'
import type { LightingProfile, SwatchCapture } from '../engine/types.ts'

// §5.3 validation thresholds, in normalized linear terms.
export const ANCHOR_CLIP = 0.98
export const ANCHOR_UNDEREXPOSED = 0.15
/** Luminance variance above this means something is occluding the anchor. */
export const ANCHOR_VARIANCE_MAX = 0.003
/** §2: an 18% gray card is the optional absolute-leaning anchor. */
export const GRAY_CARD_LINEAR = 0.18

export type RejectReason = 'clipped' | 'underexposed' | 'occluded'

/** §10.2: rejection prompts must be clear and non-technical. */
const REJECT_MESSAGES: Record<RejectReason, string> = {
  clipped:
    'The white dab is washed out in this shot — too much light hit it. Angle the board away from the light or step back, then take the photo again.',
  underexposed:
    'This shot is too dark to read the white dab. Add light or move closer to it, then take the photo again.',
  occluded:
    'The white dab doesn’t look like one solid patch here — something may be covering it, or the tap landed off the dab. Take the photo again with the dab clearly visible.',
}

export class FrameRejectedError extends Error {
  reason: RejectReason
  constructor(reason: RejectReason) {
    super(REJECT_MESSAGES[reason])
    this.reason = reason
  }
}

export type LinearRgb = [number, number, number]

/** §5.1: all arithmetic happens in linear space. 8-bit sRGB in, linear out. */
export function srgb8ToLinear(r: number, g: number, b: number): LinearRgb {
  return [srgbChannelToLinear(r / 255), srgbChannelToLinear(g / 255), srgbChannelToLinear(b / 255)]
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * §5.2–5.3: median (not mean) of the anchor region's linear pixels, then
 * validate. Throws FrameRejectedError with a non-technical prompt.
 */
export function sampleAnchor(pixelsLinear: ArrayLike<number>[]): LinearRgb {
  if (pixelsLinear.length < 5) throw new FrameRejectedError('occluded')
  const anchor: LinearRgb = [
    median(Array.from(pixelsLinear, (p) => p[0])),
    median(Array.from(pixelsLinear, (p) => p[1])),
    median(Array.from(pixelsLinear, (p) => p[2])),
  ]
  if (anchor.some((c) => c >= ANCHOR_CLIP)) throw new FrameRejectedError('clipped')
  if (anchor.every((c) => c < ANCHOR_UNDEREXPOSED)) throw new FrameRejectedError('underexposed')
  const lum = Array.from(pixelsLinear, (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2])
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length
  const variance = lum.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lum.length
  if (variance > ANCHOR_VARIANCE_MAX) throw new FrameRejectedError('occluded')
  return anchor
}

/** §5.4: gain_c = anchorReference_c / measured_c. White balance + exposure in one. */
export function vonKriesGains(
  anchorReference: { r: number; g: number; b: number },
  measuredAnchor: ArrayLike<number>,
): LinearRgb {
  return [
    anchorReference.r / Math.max(measuredAnchor[0], 1e-4),
    anchorReference.g / Math.max(measuredAnchor[1], 1e-4),
    anchorReference.b / Math.max(measuredAnchor[2], 1e-4),
  ]
}

export function applyGains(pixelLinear: ArrayLike<number>, gains: LinearRgb): LinearRgb {
  return [pixelLinear[0] * gains[0], pixelLinear[1] * gains[1], pixelLinear[2] * gains[2]]
}

/** Full §5 pipeline for one sampled region: raw linear + frame anchor → corrected Lab(D65). */
export function correctToLab(
  rawLinear: ArrayLike<number>,
  frameAnchor: ArrayLike<number>,
  profile: Pick<LightingProfile, 'anchorReference'>,
): Lab {
  const gains = vonKriesGains(profile.anchorReference, frameAnchor)
  return linearRgbToLabD65(applyGains(rawLinear, gains))
}

/** Median a sampled swatch region (linear pixels) into one raw color. */
export function medianRegion(pixelsLinear: ArrayLike<number>[]): LinearRgb {
  return [
    median(Array.from(pixelsLinear, (p) => p[0])),
    median(Array.from(pixelsLinear, (p) => p[1])),
    median(Array.from(pixelsLinear, (p) => p[2])),
  ]
}

export function buildSwatchCapture(
  pigmentId: string,
  rawLinear: ArrayLike<number>,
  frameAnchor: ArrayLike<number>,
  profile: Pick<LightingProfile, 'anchorReference'>,
  capturedAt: number,
): SwatchCapture {
  const lab = correctToLab(rawLinear, frameAnchor, profile)
  return {
    pigmentId,
    correctedLab: { L: lab[0], a: lab[1], b: lab[2] },
    rawLinearRgb: { r: rawLinear[0], g: rawLinear[1], b: rawLinear[2] },
    rawAnchorLinearRgb: { r: frameAnchor[0], g: frameAnchor[1], b: frameAnchor[2] },
    capturedAt,
  }
}

/**
 * §3 / AC4: a revised algorithm reprocesses the whole library from raw —
 * no user re-capture. Returns a new profile object; never mutates.
 */
export function reprocessProfile(profile: LightingProfile): LightingProfile {
  return {
    ...profile,
    swatches: profile.swatches.map((s) => {
      const lab = correctToLab(
        [s.rawLinearRgb.r, s.rawLinearRgb.g, s.rawLinearRgb.b],
        [s.rawAnchorLinearRgb.r, s.rawAnchorLinearRgb.g, s.rawAnchorLinearRgb.b],
        profile,
      )
      return { ...s, correctedLab: { L: lab[0], a: lab[1], b: lab[2] } }
    }),
  }
}

export interface SwatchMatch {
  pigmentId: string
  deltaE2000: number
  capturedAt: number
}

/**
 * §5.6: compare with ΔE2000 (never ΔE76) against ONE profile's library.
 * Cross-profile comparison is disallowed at this query layer: the function
 * takes a single profile and reads nothing else — there is deliberately no
 * API that accepts multiple profiles or a profile id list.
 */
export function matchInProfile(profile: LightingProfile, lab: Lab, limit = 3): SwatchMatch[] {
  return profile.swatches
    .map((s) => ({
      pigmentId: s.pigmentId,
      deltaE2000: deltaE00(lab, [s.correctedLab.L, s.correctedLab.a, s.correctedLab.b]),
      capturedAt: s.capturedAt,
    }))
    .sort((a, b) => a.deltaE2000 - b.deltaE2000)
    .slice(0, limit)
}

/** §7: the default active profile is the most-used, not the most recent. */
export function defaultProfile(profiles: LightingProfile[]): LightingProfile | null {
  if (!profiles.length) return null
  return [...profiles].sort((a, b) => b.useCount - a.useCount || b.lastVerifiedAt - a.lastVerifiedAt)[0]
}

/** §8: artificial-light profiles want re-verification after six months. */
export const REVERIFY_AFTER_MS = 183 * 24 * 3600 * 1000
export function needsReverification(profile: LightingProfile, now: number): boolean {
  return profile.kind === 'artificial' && now - profile.lastVerifiedAt > REVERIFY_AFTER_MS
}
