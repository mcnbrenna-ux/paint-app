// Region color extraction (spec §5): reject specular outliers (top-decile
// luminance), median the remainder, convert to Lab(D50). The captureError of
// the calibration that produced the pixels rides along forever — it never
// gets laundered off.

import type { Calibration } from './calibrate.ts'
import { linearRgbToLabD50, type Lab } from './lab.ts'

export interface ExtractedColor {
  lab: Lab
  linear_rgb: [number, number, number]
  captureError: number
  sample_count: number
  rejected_specular: number
}

export class ExtractionError extends Error {}

/**
 * @param pixelsLinearRgb raw (uncorrected) linear-RGB samples from the tapped
 *   radius at capture resolution.
 */
export function extractRegion(pixelsLinearRgb: number[][], calibration: Calibration): ExtractedColor {
  if (pixelsLinearRgb.length < 5) throw new ExtractionError('Too few pixels in sample region')
  const corrected = pixelsLinearRgb.map((p) => calibration.correct(p))

  // Specular rejection: drop the top luminance decile.
  const withLum = corrected.map((rgb) => ({
    rgb,
    lum: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2],
  }))
  withLum.sort((a, b) => a.lum - b.lum)
  const cutoff = Math.max(1, Math.floor(withLum.length * 0.9))
  const kept = withLum.slice(0, cutoff)
  const rejected = withLum.length - kept.length

  // Per-channel median of the remainder.
  const median = (values: number[]): number => {
    const s = [...values].sort((a, b) => a - b)
    const mid = s.length >> 1
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }
  const rgb: [number, number, number] = [
    median(kept.map((k) => k.rgb[0])),
    median(kept.map((k) => k.rgb[1])),
    median(kept.map((k) => k.rgb[2])),
  ]

  return {
    lab: linearRgbToLabD50(rgb),
    linear_rgb: rgb,
    captureError: calibration.captureError,
    sample_count: kept.length,
    rejected_specular: rejected,
  }
}

/** Blown-highlight check for the raked-angle protocol (spec §4): a cluster of
 * near-clipped pixels in the sampled region forces a re-shoot. */
export function hasBlownHighlights(pixelsLinearRgb: number[][], fraction = 0.1): boolean {
  let blown = 0
  for (const p of pixelsLinearRgb) {
    if (p[0] > 0.98 || p[1] > 0.98 || p[2] > 0.98) blown++
  }
  return blown / pixelsLinearRgb.length > fraction
}
