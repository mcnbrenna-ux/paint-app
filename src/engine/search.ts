// Mix search (spec §4). Enumerate combinations of 1..k owned paints, find the
// continuous optimum on each combination's K/S hull via NNLS, prune hulls that
// can't reach the target, quantize to integer parts totaling 12, score by
// rescaled OKLab delta-E, penalize complexity, dedup by pigment-code set.

import { deltaE, hexToLinearRgb, linearRgbToHex, linearRgbToOklab, type Oklab } from './color.ts'
import { confidenceBand } from './confidence.ts'
import { missingPigmentClass } from './gamut.ts'
import { ksVecToReflectance, mixKS, reflectanceVecToKS, type MixComponent } from './km.ts'
import { NNLSError, nnlsSimplex } from './nnls.ts'
import type { ConfidenceBand, Paint } from './types.ts'

export const TOTAL_PARTS = 12
export const ACHIEVABLE_DE = 6.0
export const MIX_IT_DE = 3.0
// Between ACHIEVABLE and NEAR_MISS the honest read is "visibly off but worth
// trying", not "impossible" — flat 'not achievable' at dE 6.5 destroys trust.
export const NEAR_MISS_DE = 10.0

export function verdictLabel(de: number): string {
  if (de <= MIX_IT_DE) return 'mix it'
  if (de <= ACHIEVABLE_DE) return 'usable start, adjust by eye'
  if (de <= NEAR_MISS_DE) return 'borderline — expect a visible difference'
  return 'out of reach with these tubes'
}
// Relative K/S residual above which a combination's hull is considered unable
// to reach the target. Lenient on purpose: K/S distance is not perceptual.
const PRUNE_TAU = 0.6
const THREE_PAINT_PENALTY = 0.5
const EXTRA_PAINT_PENALTY = 0.5
const NON_REDUCIBLE_PENALTY = 0.3

export interface SearchRecipe {
  /** Aligned arrays, sorted by parts descending (mixing order: largest first). */
  paint_ids: string[]
  /** Integer parts, reduced by gcd, total <= 12. */
  parts: number[]
  predicted_oklab: [number, number, number]
  predicted_hex: string
  delta_e: number
  confidence_band: ConfidenceBand
}

export interface SearchOutput {
  results: SearchRecipe[]
  achievable: boolean
  /** Set when not achievable: the single pigment class that would close the gap. */
  missing_pigment_class?: string
  target_oklab: [number, number, number]
  evaluated_combos: number
  skipped_combos: number
}

export interface SearchOptions {
  /** Max paints per recipe. 3 by default; 4 only behind an explicit "search harder". */
  maxK?: 2 | 3 | 4
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

function gcdAll(parts: number[]): number {
  return parts.reduce(gcd)
}

/** Largest-remainder quantization of simplex weights to parts summing to total, each >= 1. */
function quantizeWeights(w: Float64Array, total: number): number[] {
  const k = w.length
  const raw = Array.from(w, (x) => x * total)
  const parts = raw.map(Math.floor)
  let remaining = total - parts.reduce((a, b) => a + b, 0)
  const order = raw
    .map((x, i) => ({ frac: x - Math.floor(x), i }))
    .sort((a, b) => b.frac - a.frac)
  for (let n = 0; n < remaining; n++) parts[order[n % k].i]++
  // Keep every member present: steal from the largest for any zero.
  for (let i = 0; i < k; i++) {
    while (parts[i] < 1) {
      const maxI = parts.indexOf(Math.max(...parts))
      if (parts[maxI] <= 1) break
      parts[maxI]--
      parts[i]++
    }
  }
  return parts
}

/** Base composition plus all single-part transfers (quantized neighborhood, radius 1). */
function neighborhood(base: number[]): number[][] {
  const out: number[][] = [base]
  const k = base.length
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i === j || base[i] < 2) continue
      const v = base.slice()
      v[i]--
      v[j]++
      out.push(v)
    }
  }
  return out
}

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i)
  if (k > n) return
  for (;;) {
    yield idx.slice()
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

interface ComboBest {
  paints: Paint[]
  parts: number[]
  deltaE: number
  oklab: Oklab
  rgb: Float64Array
  pruned: boolean
}

export interface SearchProgress {
  done: number
  total: number
}

/**
 * Core search as a generator so callers can drive it in chunks (the UI needs a
 * determinate progress indicator; the CLI just drains it).
 */
// Above this many usable tubes, C(n,3) makes the full search miss the 3-second
// budget. Pre-select tubes whose reachable locus passes near the target,
// always keeping whites and blacks (value adjusters mix into everything).
//
// Ranking by masstone distance alone is wrong: the paints a tint needs (white
// + a strong chromatic) both sit FAR from a pastel target in masstone space.
// Instead each tube is scored by the closest point among samples along its
// tint ladder (masstone, 1:1, 1:3, 1:9 in a canonical white), which is where
// mixing actually happens.
const MAX_SEARCH_TUBES = 48
const NEAREST_KEEP = 40
const CANONICAL_WHITE_HEX = '#F5F4EF'

function preselect(paints: Paint[], targetHex: string): Paint[] {
  if (paints.length <= MAX_SEARCH_TUBES) return paints
  const targetLab = linearRgbToOklab(hexToLinearRgb(targetHex))
  const whiteKS = reflectanceVecToKS(hexToLinearRgb(CANONICAL_WHITE_HEX))
  const ladder = [0, 1, 3, 9] // parts of white per 1 part paint
  const ranked = paints
    .map((p) => {
      const ks = Float64Array.from(p.ks)
      let best = Infinity
      for (const w of ladder) {
        const mixed =
          w === 0
            ? ks
            : mixKS([
                { ks, s: p.tinting_strength, v: 1 },
                { ks: whiteKS, s: 1, v: w },
              ])
        const de = deltaE(linearRgbToOklab(ksVecToReflectance(mixed)), targetLab)
        if (de < best) best = de
      }
      return { p, de: best }
    })
    .sort((a, b) => a.de - b.de)
  const keep = new Set(ranked.slice(0, NEAREST_KEEP).map((r) => r.p))
  for (const p of paints) {
    const lead = p.pigment_ids[0]
    if (lead?.startsWith('PW') || lead?.startsWith('PBk')) keep.add(p)
  }
  return paints.filter((p) => keep.has(p))
}

export function* searchGenerator(
  allPaints: Paint[],
  targetHex: string,
  opts: SearchOptions = {},
): Generator<SearchProgress, SearchOutput> {
  const maxK = opts.maxK ?? 3
  if (allPaints.length < 2) throw new Error('Mix search needs at least 2 usable tubes')
  const paints = preselect(allPaints, targetHex)
  const n = paints.length

  const targetLin = hexToLinearRgb(targetHex)
  const targetKS = reflectanceVecToKS(targetLin)
  const targetLab = linearRgbToOklab(targetLin)
  let targetKSNorm = 0
  for (const v of targetKS) targetKSNorm += v * v
  targetKSNorm = Math.sqrt(targetKSNorm)

  const ksCols = paints.map((p) => Float64Array.from(p.ks))

  let total = 0
  for (let k = 1; k <= Math.min(maxK, n); k++) {
    let c = 1
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1)
    total += Math.round(c)
  }

  const bests: ComboBest[] = []
  let done = 0
  let skipped = 0

  const evaluate = (comboIdx: number[], parts: number[]): { de: number; lab: Oklab; rgb: Float64Array } => {
    const components: MixComponent[] = comboIdx.map((pi, i) => ({
      ks: ksCols[pi],
      s: paints[pi].tinting_strength,
      v: parts[i],
    }))
    const rgb = ksVecToReflectance(mixKS(components))
    const lab = linearRgbToOklab(rgb)
    return { de: deltaE(lab, targetLab), lab, rgb }
  }

  for (let k = 1; k <= Math.min(maxK, n); k++) {
    for (const combo of combinations(n, k)) {
      done++
      if (done % 400 === 0) yield { done, total }
      try {
        let weights: Float64Array
        let pruned = false
        if (k === 1) {
          weights = new Float64Array([1])
        } else {
          const { weights: w, residual } = nnlsSimplex(
            combo.map((i) => ksCols[i]),
            targetKS,
          )
          weights = w
          // Target outside this hull. Still evaluate the base quantization
          // (cheap) so a best-available result exists even when nothing is
          // achievable — but skip the neighborhood expansion.
          pruned = residual / (targetKSNorm + 1) > PRUNE_TAU
        }
        const base = quantizeWeights(weights, TOTAL_PARTS)
        const candidates = pruned || k === 1 ? [base] : neighborhood(base)
        let best: { parts: number[]; de: number; lab: Oklab; rgb: Float64Array } | null = null
        for (const parts of candidates) {
          const { de, lab, rgb } = evaluate(combo, parts)
          if (!best || de < best.de) best = { parts, de, lab, rgb }
        }
        if (best) {
          bests.push({
            paints: combo.map((i) => paints[i]),
            parts: best.parts,
            deltaE: best.de,
            oklab: best.lab,
            rgb: best.rgb,
            pruned,
          })
        }
      } catch (e) {
        // Failure mode (e): NNLS non-convergence — skip combination, log, never crash.
        if (e instanceof NNLSError) {
          skipped++
          continue
        }
        throw e
      }
    }
  }

  // Score = delta-E + complexity penalties. Delta-E itself is reported raw.
  const scored = bests
    .map((b) => {
      const k = b.paints.length
      let score = b.deltaE
      if (k === 3) score += THREE_PAINT_PENALTY
      if (k === 4) score += THREE_PAINT_PENALTY + EXTRA_PAINT_PENALTY
      if (k > 1 && gcdAll(b.parts) === 1) score += NON_REDUCIBLE_PENALTY
      return { ...b, score }
    })
    .sort((a, b) => a.score - b.score)

  // Dedup by pigment-code set: two recipes built on the same pigments are the
  // same mix as far as the palette is concerned.
  const seen = new Set<string>()
  const top: ComboBest[] = []
  for (const s of scored) {
    const key = [...new Set(s.paints.flatMap((p) => p.pigment_ids))].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    top.push(s)
    if (top.length === 5) break
  }

  const bestDe = top.length ? Math.min(...top.map((t) => t.deltaE)) : Infinity
  const achievable = bestDe <= ACHIEVABLE_DE

  const results: SearchRecipe[] = top.map((t) => {
    // Sort components by parts descending (mixing order: largest volume first)
    // and reduce the ratio for display.
    const order = t.parts.map((_, i) => i).sort((a, b) => t.parts[b] - t.parts[a])
    const parts = order.map((i) => t.parts[i])
    const orderedPaints = order.map((i) => t.paints[i])
    const g = gcdAll(parts)
    return {
      paint_ids: orderedPaints.map((p) => p.id),
      parts: parts.map((p) => p / g),
      predicted_oklab: [...t.oklab] as [number, number, number],
      predicted_hex: linearRgbToHex(t.rgb),
      delta_e: t.deltaE,
      confidence_band: confidenceBand({ target: targetLab, paints: orderedPaints, parts }),
    }
  })

  const output: SearchOutput = {
    results,
    achievable,
    target_oklab: [...targetLab] as [number, number, number],
    evaluated_combos: done,
    skipped_combos: skipped,
  }
  if (!achievable) {
    output.missing_pigment_class = missingPigmentClass(
      targetLab,
      results.length ? results[0].predicted_oklab : null,
    )
  }
  return output
}

/** Synchronous drain — used by the CLI and tests. */
export function searchMixes(paints: Paint[], targetHex: string, opts: SearchOptions = {}): SearchOutput {
  const gen = searchGenerator(paints, targetHex, opts)
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
  }
}

/** Chunked async drain — yields to the event loop so the UI can paint progress. */
export async function searchMixesAsync(
  paints: Paint[],
  targetHex: string,
  opts: SearchOptions = {},
  onProgress?: (p: SearchProgress) => void,
): Promise<SearchOutput> {
  const gen = searchGenerator(paints, targetHex, opts)
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
    onProgress?.(r.value)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
