// Three-band confidence label (spec §4). The band communicates model
// reliability — the honest surface for the 3-channel K/S tradeoff — not match
// quality (that's what delta-E is for).

import { type Oklab, oklabChroma } from './color.ts'
import type { ConfidenceBand, Paint } from './types.ts'

// High-chroma modern organics where the 3-channel model degrades badly
// (spec §4: phthalos, quinacridones, dioxazine — hue error of 10+ dE realistic).
const HIGH_CHROMA_ORGANICS = new Set([
  'PB15', 'PB15:1', 'PB15:3', 'PB15:4', 'PB15:6', 'PB16',
  'PG7', 'PG36',
  'PV19', 'PV23', 'PR122', 'PR254', 'PR255',
])

const ORDER: ConfidenceBand[] = ['high', 'medium', 'low']

function drop(band: ConfidenceBand): ConfidenceBand {
  return ORDER[Math.min(ORDER.indexOf(band) + 1, ORDER.length - 1)]
}

function capAt(band: ConfidenceBand, cap: ConfidenceBand): ConfidenceBand {
  return ORDER.indexOf(band) < ORDER.indexOf(cap) ? cap : band
}

export interface ConfidenceInput {
  target: Oklab
  paints: Paint[]
  parts: number[]
}

export function confidenceBand({ target, paints, parts }: ConfidenceInput): ConfidenceBand {
  let band: ConfidenceBand = 'high'
  const chroma = oklabChroma(target)

  // 3-channel model is least reliable on high-chroma organics when chasing
  // a chromatic target.
  const usesOrganic = paints.some((p) => p.pigment_ids.some((id) => HIGH_CHROMA_ORGANICS.has(id)))
  if (usesOrganic && chroma > 0.09) band = drop(band)

  // Failure mode (b): very dark, high-chroma targets — single-constant KM is
  // least reliable there; band drops automatically below the L threshold.
  if (target[0] < 0.35 && chroma > 0.09) band = drop(band)

  // Failure mode (c): white-dominated tints — tinting-strength error dominates.
  const total = parts.reduce((a, b) => a + b, 0)
  let whiteParts = 0
  paints.forEach((p, i) => {
    if (p.pigment_ids.length === 1 && p.pigment_ids[0] === 'PW6') whiteParts += parts[i]
  })
  if (total > 0 && whiteParts / total >= 2 / 3) band = drop(band)

  // Estimated (non-swatched) paint data caps confidence at medium. Phase 1
  // swatch measurement upgrades source to 'measured' and unlocks 'high'.
  if (paints.some((p) => p.source === 'estimated' || p.confidence < 0.5)) {
    band = capAt(band, 'medium')
  }

  return band
}

export const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  high: 'High confidence',
  medium: 'Decent estimate',
  low: 'Rough guess',
}

export const CONFIDENCE_HELP: Record<ConfidenceBand, string> = {
  high: 'Pigment data is measured and this mix is in the model’s reliable range.',
  medium: 'Expect to adjust by eye — pigment data or this color range limits precision.',
  low: 'Dark high-chroma or white-dominated mixes are where this model is weakest. Treat as a starting point only.',
}
