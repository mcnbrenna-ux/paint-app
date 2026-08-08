// Capture calibration pipeline (spec §4). CLI-first — no UI ships until the
// physical Phase A gate passes (median captureError <= 4.0 dE00 across a
// 20-photo test set under 3 lighting conditions).
//
// Two reference targets:
// - Neutral gray card (18%): single-patch white balance + exposure
//   normalization. One patch cannot detect color cast nonlinearity, so its
//   captureError is floored at GRAY_CARD_ERROR_FLOOR rather than reported as
//   the (trivially ~0) single-patch residual. A floor is honest; 0 would lie.
// - 24-patch ColorChecker: least-squares 3x3 color correction matrix in
//   linear RGB plus a per-channel piecewise-linear LUT fitted on the six
//   neutral patches. captureError = mean dE00 across all 24 corrected
//   patches vs reference values.

import { hexToLinearRgb } from '../engine/color.ts'
import { deltaE00, labD50ToLinearRgb, linearRgbToLabD50, type Lab } from './lab.ts'

export const CAPTURE_REJECT_DE = 6.0
export const GRAY_CARD_ERROR_FLOOR = 3.5
// Owner-approved spec amendment (docs/spec-amendments.md): a thick matte
// patch of the user's own titanium white may serve as the reference target.
// Weaker than a manufactured card — whites vary by brand and a glossy patch
// misleads — so the error floor is wider still. It is calibration with an
// admitted cost, not a skip-calibration path.
export const TITANIUM_WHITE_ERROR_FLOOR = 5.0
export const DEFAULT_TITANIUM_WHITE_HEX = '#F5F4EF'

// Classic 24-patch ColorChecker reference values, Lab(D50), BabelColor
// averages. Reference data, not measured by us.
export const COLORCHECKER_LAB: Lab[] = [
  [37.99, 13.56, 14.06],
  [65.71, 18.13, 17.81],
  [49.93, -4.88, -21.93],
  [43.14, -13.1, 21.91],
  [55.11, 8.84, -25.4],
  [70.72, -33.4, -0.2],
  [62.66, 36.07, 57.1],
  [40.02, 10.41, -45.96],
  [51.12, 48.24, 16.25],
  [30.33, 22.98, -21.59],
  [72.53, -23.71, 57.26],
  [71.94, 19.36, 67.86],
  [28.78, 14.18, -50.3],
  [55.26, -38.34, 31.37],
  [42.1, 53.38, 28.19],
  [81.73, 4.04, 79.82],
  [51.94, 49.99, -14.57],
  [51.04, -28.63, -28.64],
  [96.54, -0.43, 1.19],
  [81.26, -0.64, -0.34],
  [66.77, -0.73, -0.5],
  [50.87, -0.15, -0.27],
  [35.66, -0.42, -1.23],
  [20.46, -0.08, -0.97],
]
// Indices of the neutral ramp (white -> black) used for the 1D LUTs.
const NEUTRAL_PATCHES = [18, 19, 20, 21, 22, 23]

export interface Calibration {
  kind: 'gray_card' | 'colorchecker' | 'titanium_white'
  /** Mean dE00 of corrected patches vs reference (floored for gray card). */
  captureError: number
  /** Corrects a linear-RGB sample from the photographed frame. */
  correct: (rgb: ArrayLike<number>) => [number, number, number]
}

export class CaptureRejectedError extends Error {
  captureError: number
  constructor(message: string, captureError: number) {
    super(message)
    this.captureError = captureError
  }
}

/** 18% gray card: per-channel gain doing white balance + exposure at once. */
export function calibrateGrayCard(observedCardLinearRgb: ArrayLike<number>): Calibration {
  const gains = [0, 1, 2].map((c) => {
    const v = observedCardLinearRgb[c]
    if (!(v > 1e-4)) throw new CaptureRejectedError('Gray card patch reads as black — likely not the card.', Infinity)
    return 0.18 / v
  })
  return {
    kind: 'gray_card',
    captureError: GRAY_CARD_ERROR_FLOOR,
    correct: (rgb) => [rgb[0] * gains[0], rgb[1] * gains[1], rgb[2] * gains[2]],
  }
}

/**
 * Titanium-white patch calibration: per-channel gains mapping the observed
 * patch to the reference white. Pass the masstone of the user's actual white
 * tube (from their inventory) when known; defaults to the catalog's titanium
 * white estimate.
 */
export function calibrateTitaniumWhite(
  observedPatchLinearRgb: ArrayLike<number>,
  referenceLinearRgb: ArrayLike<number> = hexToLinearRgb(DEFAULT_TITANIUM_WHITE_HEX),
): Calibration {
  const o = [observedPatchLinearRgb[0], observedPatchLinearRgb[1], observedPatchLinearRgb[2]]
  if (o.some((v) => v >= 0.995)) {
    throw new CaptureRejectedError(
      'The white patch is clipped — the camera blew it out, so its true color is unrecoverable. ' +
        'Lower the exposure or angle the light away and re-shoot.',
      Infinity,
    )
  }
  const lum = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2]
  if (lum < 0.15) {
    throw new CaptureRejectedError(
      'The white patch reads far too dark to be titanium white — check that the paint patch is in frame and lit.',
      Infinity,
    )
  }
  const gains = [0, 1, 2].map((c) => referenceLinearRgb[c] / Math.max(o[c], 1e-4))
  return {
    kind: 'titanium_white',
    captureError: TITANIUM_WHITE_ERROR_FLOOR,
    correct: (rgb) => [rgb[0] * gains[0], rgb[1] * gains[1], rgb[2] * gains[2]],
  }
}

/** Least squares solve for X (3x3) minimizing ||O·X - T||, O,T as n x 3. */
function solveCCM(observed: number[][], target: number[][]): number[][] {
  // Normal equations: (OᵀO) X = OᵀT, solved column by column.
  const ata = Array.from({ length: 3 }, () => [0, 0, 0])
  const atb = Array.from({ length: 3 }, () => [0, 0, 0])
  for (let r = 0; r < observed.length; r++) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        ata[i][j] += observed[r][i] * observed[r][j]
        atb[i][j] += observed[r][i] * target[r][j]
      }
    }
  }
  // Invert 3x3 ata.
  const m = ata
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  if (Math.abs(det) < 1e-12) throw new CaptureRejectedError('Degenerate patch data — cannot fit correction.', Infinity)
  const inv = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det,
    ],
  ]
  // X = inv(AtA) · AtB
  return Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => inv[i][0] * atb[0][j] + inv[i][1] * atb[1][j] + inv[i][2] * atb[2][j]),
  )
}

/** Monotone piecewise-linear map through the neutral-ramp control points. */
function lutApply(points: [number, number][], v: number): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0])
  if (v <= sorted[0][0]) return sorted[0][1] + (v - sorted[0][0])
  for (let i = 1; i < sorted.length; i++) {
    if (v <= sorted[i][0]) {
      const [x0, y0] = sorted[i - 1]
      const [x1, y1] = sorted[i]
      const t = x1 === x0 ? 0 : (v - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  const last = sorted[sorted.length - 1]
  return last[1] + (v - last[0])
}

/**
 * 24-patch ColorChecker calibration.
 * @param observedPatchesLinearRgb 24 observed patch colors, linear sRGB, in
 *   standard ColorChecker order (dark skin ... black).
 */
export function calibrateColorChecker(observedPatchesLinearRgb: number[][]): Calibration {
  if (observedPatchesLinearRgb.length !== 24) {
    throw new CaptureRejectedError('ColorChecker calibration needs all 24 patches.', Infinity)
  }
  const targetRgb = COLORCHECKER_LAB.map((lab) => [...labD50ToLinearRgb(lab)])
  const ccm = solveCCM(observedPatchesLinearRgb, targetRgb)
  const applyCCM = (rgb: ArrayLike<number>): [number, number, number] => [
    rgb[0] * ccm[0][0] + rgb[1] * ccm[1][0] + rgb[2] * ccm[2][0],
    rgb[0] * ccm[0][1] + rgb[1] * ccm[1][1] + rgb[2] * ccm[2][1],
    rgb[0] * ccm[0][2] + rgb[1] * ccm[1][2] + rgb[2] * ccm[2][2],
  ]
  // Per-channel LUT on the neutral ramp, fitted after the CCM.
  const luts: [number, number][][] = [0, 1, 2].map((c) =>
    NEUTRAL_PATCHES.map((pi) => {
      const corrected = applyCCM(observedPatchesLinearRgb[pi])
      return [corrected[c], targetRgb[pi][c]] as [number, number]
    }),
  )
  const correct = (rgb: ArrayLike<number>): [number, number, number] => {
    const c = applyCCM(rgb)
    return [lutApply(luts[0], c[0]), lutApply(luts[1], c[1]), lutApply(luts[2], c[2])]
  }

  let sum = 0
  for (let i = 0; i < 24; i++) {
    sum += deltaE00(linearRgbToLabD50(correct(observedPatchesLinearRgb[i])), COLORCHECKER_LAB[i])
  }
  const captureError = sum / 24
  if (captureError > CAPTURE_REJECT_DE) {
    throw new CaptureRejectedError(
      `Capture rejected: residual ${captureError.toFixed(1)} dE00 after correction. ` +
        'Likely causes: mixed lighting, glare on the card, or a dirty/faded card. Re-shoot in even, diffuse light.',
      captureError,
    )
  }
  return { kind: 'colorchecker', captureError, correct }
}
