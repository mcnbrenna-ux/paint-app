// Diagnosis (spec §7): predicted color of the declared mix vs the extracted
// actual color. Hypotheses come from a CLOSED list, ranked by rules over the
// direction of the Lab delta. If the pattern matches nothing, say so and stop.

import { ksVecToReflectance, mixKS, type MixComponent } from '../engine/km.ts'
import type { Paint } from '../engine/types.ts'
import { compoundedError, type ErrorBand } from './errors.ts'
import { deltaE00, linearRgbToLabD50, type Lab } from './lab.ts'

export type Hypothesis =
  | 'proportion_drift'
  | 'medium_dilution'
  | 'insufficient_mixing'
  | 'substrate_show_through'
  | 'outside_model'

export const HYPOTHESIS_TEXT: Record<Hypothesis, string> = {
  proportion_drift: 'Proportions drifted from the declared parts — likely more of the stronger tinter than intended.',
  medium_dilution: 'Medium or solvent is diluting the paint film and lifting the value.',
  insufficient_mixing: 'The pile isn’t fully mixed — streaks read as a shifted average.',
  substrate_show_through: 'The layer is thin enough that the ground or underlayer is showing through.',
  outside_model: 'Outside model — likely capture or declaration error.',
}

export interface Diagnosis {
  predicted_lab: Lab
  actual_lab: Lab
  delta_e00: number
  error_band: ErrorBand
  /** true when the delta exceeds the compounded error band. */
  exceeds_band: boolean
  /** Ranked, only present when exceeds_band; closed list, max 3. */
  hypotheses: Hypothesis[]
}

export interface DeclaredMix {
  components: { paint: Paint; parts: number }[]
}

export function predictDeclaredMix(mix: DeclaredMix): Lab {
  const comps: MixComponent[] = mix.components.map((c) => ({
    ks: Float64Array.from(c.paint.ks),
    s: c.paint.tinting_strength,
    v: c.parts,
  }))
  return linearRgbToLabD50(ksVecToReflectance(mixKS(comps)))
}

/** Rule-derived ranking from the direction of the Lab delta (spec §7). */
function rankHypotheses(predicted: Lab, actual: Lab): Hypothesis[] {
  const dL = actual[0] - predicted[0]
  const dChroma = Math.hypot(actual[1], actual[2]) - Math.hypot(predicted[1], predicted[2])
  const dHueDist = Math.hypot(actual[1] - predicted[1], actual[2] - predicted[2])
  const lighter = dL > 2
  const darker = dL < -2
  const duller = dChroma < -2
  const brighter = dChroma > 2

  if (lighter && duller) return ['medium_dilution', 'substrate_show_through', 'proportion_drift']
  if (lighter && brighter) return ['substrate_show_through', 'proportion_drift']
  if (lighter) return ['medium_dilution', 'substrate_show_through']
  if (darker && brighter) return ['proportion_drift', 'insufficient_mixing']
  if (darker && duller) return ['proportion_drift', 'insufficient_mixing']
  if (darker) return ['proportion_drift', 'insufficient_mixing']
  // Value matched: hue/chroma shift alone.
  if (dHueDist > 4 || duller || brighter) return ['proportion_drift', 'insufficient_mixing']
  return ['outside_model']
}

export function diagnose(mix: DeclaredMix, actual: Lab, captureError: number): Diagnosis {
  const predicted = predictDeclaredMix(mix)
  const de = deltaE00(predicted, actual)
  const band = compoundedError(captureError)
  const exceeds = de > band.value
  return {
    predicted_lab: predicted,
    actual_lab: actual,
    delta_e00: de,
    error_band: band,
    exceeds_band: exceeds,
    hypotheses: exceeds ? rankHypotheses(predicted, actual) : [],
  }
}
