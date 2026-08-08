// Layer preview math (spec §9): transform the user's pixels, never generate
// imagery. Single-constant K-M layer-over-substrate composite.
//
// With a single K/S constant there is no independent film thickness term, so
// layer coverage is modeled as partial optical mixing in K/S space: the layer
// contributes a thickness-dependent weight alpha, the substrate the rest.
// This IS an approximation on top of an approximation — which is exactly why
// every preview carries the compounded error band (spec §6) and the
// substrate-from-RGB caveat (spec §13 risk 2).

import { mixKS, reflectanceVecToKS, ksVecToReflectance, type MixComponent } from '../engine/km.ts'
import type { Paint } from '../engine/types.ts'

export type ThicknessClass = 'glaze' | 'thinScumble' | 'opaque'

export interface LayerSpec {
  recipe: { paint: Paint; parts: number }[]
  thicknessClass: ThicknessClass
  /** 0..1 — extra medium thins the layer's optical weight. */
  mediumLoad: number
}

const ALPHA: Record<ThicknessClass, number> = {
  glaze: 0.35,
  thinScumble: 0.6,
  opaque: 1.0,
}

export function layerKS(spec: LayerSpec): Float64Array {
  const comps: MixComponent[] = spec.recipe.map((c) => ({
    ks: Float64Array.from(c.paint.ks),
    s: c.paint.tinting_strength,
    v: c.parts,
  }))
  return mixKS(comps)
}

export function layerAlpha(spec: LayerSpec): number {
  if (spec.thicknessClass === 'opaque') return 1.0
  const load = Math.min(1, Math.max(0, spec.mediumLoad))
  return ALPHA[spec.thicknessClass] * (1 - 0.4 * load)
}

/**
 * Composite one substrate pixel (linear RGB, from the corrected photo) under
 * the proposed layer. Opaque layers return the flat predicted mix color
 * (spec §9.3 — no texture synthesis).
 */
export function compositePixel(substrateLinearRgb: ArrayLike<number>, spec: LayerSpec): [number, number, number] {
  const lks = layerKS(spec)
  const alpha = layerAlpha(spec)
  if (alpha >= 1) {
    const r = ksVecToReflectance(lks)
    return [r[0], r[1], r[2]]
  }
  // Substrate reflectance approximated from corrected pixel values — the
  // weakest link in the preview math (spec §13 risk 2), flagged upstream.
  const sks = reflectanceVecToKS(substrateLinearRgb)
  const out = new Float64Array(lks.length)
  for (let b = 0; b < lks.length; b++) out[b] = (1 - alpha) * sks[b] + alpha * lks[b]
  const r = ksVecToReflectance(out)
  return [r[0], r[1], r[2]]
}

/** Composite a whole region (array of linear-RGB pixels). */
export function compositeRegion(substrate: number[][], spec: LayerSpec): [number, number, number][] {
  return substrate.map((px) => compositePixel(px, spec))
}
