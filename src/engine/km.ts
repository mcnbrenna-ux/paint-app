// Single-constant Kubelka–Munk (spec §4). Per band:
//   K/S = (1 - R)^2 / 2R
//   R   = 1 + K/S - sqrt((K/S)^2 + 2·K/S)
// Mixture K/S is the effective-concentration-weighted sum of component K/S:
//   c_eff_i = (v_i · s_i) / Σ(v_j · s_j)
// where v is parts by volume and s is tinting strength (titanium white = 1.0).
//
// The engine is band-count agnostic: every function works on Float64Array of
// arbitrary length. v1 runs 3 bands (linear RGB channels as pseudo-reflectance).
// A 31-band spectral upgrade swaps the ColorBasis, nothing else.

// Reflectance clamp keeps K/S finite and the inversion numerically stable.
const R_MIN = 0.004
const R_MAX = 0.996

export function clampReflectance(r: number): number {
  return Math.min(R_MAX, Math.max(R_MIN, r))
}

export function reflectanceToKS(r: number): number {
  const rc = clampReflectance(r)
  return ((1 - rc) * (1 - rc)) / (2 * rc)
}

export function ksToReflectance(ks: number): number {
  return 1 + ks - Math.sqrt(ks * ks + 2 * ks)
}

export function reflectanceVecToKS(refl: ArrayLike<number>): Float64Array {
  const out = new Float64Array(refl.length)
  for (let i = 0; i < refl.length; i++) out[i] = reflectanceToKS(refl[i])
  return out
}

export function ksVecToReflectance(ks: ArrayLike<number>): Float64Array {
  const out = new Float64Array(ks.length)
  for (let i = 0; i < ks.length; i++) out[i] = ksToReflectance(ks[i])
  return out
}

export interface MixComponent {
  ks: Float64Array
  /** Tinting-strength factor, 1.0 = titanium white reference. */
  s: number
  /** Parts by volume. */
  v: number
}

/** Mixture K/S from components via effective concentrations. */
export function mixKS(components: MixComponent[]): Float64Array {
  const bands = components[0].ks.length
  let totalVS = 0
  for (const c of components) totalVS += c.v * c.s
  if (totalVS <= 0) throw new Error('mixKS: total effective concentration is zero')
  const out = new Float64Array(bands)
  for (const c of components) {
    const w = (c.v * c.s) / totalVS
    for (let b = 0; b < bands; b++) out[b] += w * c.ks[b]
  }
  return out
}
