import { describe, expect, it } from 'vitest'
import { deltaE, hexToLinearRgb, linearRgbToHex, linearRgbToOklab } from './color.ts'
import { ksToReflectance, mixKS, reflectanceToKS, reflectanceVecToKS } from './km.ts'
import { nnlsSimplex } from './nnls.ts'
import { ACHIEVABLE_DE, searchMixes } from './search.ts'
import { missingPigmentClass } from './gamut.ts'
import catalog from '../data/catalog.json'
import type { Paint } from './types.ts'

const paints = catalog.paints as Paint[]
const byName = (name: string) => {
  const p = paints.find((p) => p.brand === 'Winsor & Newton' && p.product_name === name)
  if (!p) throw new Error(`missing ${name}`)
  return p
}

const STARTER = [
  'Titanium White',
  'French Ultramarine',
  'Cerulean Blue',
  'Cadmium Yellow Light',
  'Yellow Ochre',
  'Cadmium Red',
  'Alizarin Crimson',
  'Burnt Sienna',
  'Raw Umber',
  'Ivory Black',
].map(byName)

describe('color conversions', () => {
  it('round-trips hex through linear RGB', () => {
    for (const hex of ['#000000', '#ffffff', '#6a8f5a', '#123456', '#f0e0d0']) {
      expect(linearRgbToHex(hexToLinearRgb(hex))).toBe(hex)
    }
  })

  it('OKLab of white is L=1, of black is L=0', () => {
    const white = linearRgbToOklab([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 3)
    expect(Math.hypot(white[1], white[2])).toBeLessThan(1e-3)
    const black = linearRgbToOklab([0, 0, 0])
    expect(black[0]).toBeCloseTo(0, 3)
  })

  it('deltaE is 0 for identical colors and grows with difference', () => {
    const a = linearRgbToOklab(hexToLinearRgb('#808080'))
    const b = linearRgbToOklab(hexToLinearRgb('#818081'))
    const c = linearRgbToOklab(hexToLinearRgb('#ff0000'))
    expect(deltaE(a, a)).toBe(0)
    expect(deltaE(a, b)).toBeGreaterThan(0)
    expect(deltaE(a, b)).toBeLessThan(1)
    expect(deltaE(a, c)).toBeGreaterThan(10)
  })
})

describe('Kubelka-Munk', () => {
  it('K/S <-> reflectance round-trips inside the clamp range', () => {
    for (const r of [0.01, 0.1, 0.3, 0.5, 0.8, 0.99]) {
      expect(ksToReflectance(reflectanceToKS(r))).toBeCloseTo(r, 6)
    }
  })

  it('blue + yellow makes green, not gray (the forbidden RGB-averaging result)', () => {
    const white = byName('Titanium White')
    const blue = byName('Winsor Blue (Green Shade)')
    const yellow = byName('Cadmium Yellow Light')
    // 4 white : 7 cadmium yellow : 1 phthalo blue — a classic mixing green.
    const mix = mixKS([
      { ks: Float64Array.from(white.ks), s: white.tinting_strength, v: 4 },
      { ks: Float64Array.from(yellow.ks), s: yellow.tinting_strength, v: 7 },
      { ks: Float64Array.from(blue.ks), s: blue.tinting_strength, v: 1 },
    ])
    const rgb = [ksToReflectance(mix[0]), ksToReflectance(mix[1]), ksToReflectance(mix[2])]
    const lab = linearRgbToOklab(rgb)
    const hue = ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360
    // A chromatic green (OKLab green ~140°, green-cyan up to ~200°), with the
    // green channel dominating red — not the desaturated gray RGB averaging gives.
    expect(hue).toBeGreaterThan(120)
    expect(hue).toBeLessThan(210)
    expect(Math.hypot(lab[1], lab[2])).toBeGreaterThan(0.04)
    expect(rgb[1]).toBeGreaterThan(rgb[0] * 1.5)
  })

  it('mixture K/S weights by tinting strength, not just volume', () => {
    const strong = { ks: Float64Array.from([10, 10, 10]), s: 4, v: 1 }
    const weak = { ks: Float64Array.from([0.1, 0.1, 0.1]), s: 1, v: 1 }
    const mix = mixKS([strong, weak])
    // Equal volumes, but the strong tinter contributes 4/5 of the mixture.
    expect(mix[0]).toBeCloseTo((4 / 5) * 10 + (1 / 5) * 0.1, 6)
  })
})

describe('NNLS on the simplex', () => {
  it('recovers weights for a target inside the hull', () => {
    const a = Float64Array.from([1, 0, 0])
    const b = Float64Array.from([0, 1, 0])
    const target = Float64Array.from([0.3, 0.7, 0])
    const { weights, residual } = nnlsSimplex([a, b], target)
    expect(weights[0]).toBeCloseTo(0.3, 4)
    expect(weights[1]).toBeCloseTo(0.7, 4)
    expect(residual).toBeLessThan(1e-6)
  })

  it('clamps to a vertex for a target outside the hull and reports residual', () => {
    const a = Float64Array.from([1, 1, 1])
    const b = Float64Array.from([2, 2, 2])
    const target = Float64Array.from([10, 10, 10])
    const { weights, residual } = nnlsSimplex([a, b], target)
    expect(weights[0] + weights[1]).toBeCloseTo(1, 6)
    expect(residual).toBeGreaterThan(1)
  })
})

describe('mix search', () => {
  it('finds an achievable recipe for a muted green within threshold', () => {
    const out = searchMixes(STARTER, '#8f9a6b')
    expect(out.achievable).toBe(true)
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.results.length).toBeLessThanOrEqual(5)
    expect(out.results[0].delta_e).toBeLessThanOrEqual(ACHIEVABLE_DE)
  })

  it('expresses every recipe as integer parts totaling <= 12', () => {
    const out = searchMixes(STARTER, '#8f9a6b')
    for (const r of out.results) {
      expect(r.parts.every((p) => Number.isInteger(p) && p >= 1)).toBe(true)
      expect(r.parts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12)
      expect(r.paint_ids.length).toBe(r.parts.length)
      expect(r.paint_ids.length).toBeLessThanOrEqual(3)
      // Mixing order: largest volume first.
      for (let i = 1; i < r.parts.length; i++) expect(r.parts[i]).toBeLessThanOrEqual(r.parts[i - 1])
    }
  })

  it('flags an out-of-gamut target and names the missing pigment class', () => {
    const out = searchMixes(STARTER, '#ff00ff')
    expect(out.achievable).toBe(false)
    expect(out.missing_pigment_class).toMatch(/quinacridone/i)
    // Best available result is still returned.
    expect(out.results.length).toBeGreaterThan(0)
  })

  it('dedups results by pigment-code set', () => {
    const out = searchMixes(paints.slice(0, 40), '#8f9a6b')
    const keys = out.results.map((r) => {
      const pigs = r.paint_ids.flatMap((id) => paints.find((p) => p.id === id)!.pigment_ids)
      return [...new Set(pigs)].sort().join('|')
    })
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('rejects an inventory with fewer than 2 tubes', () => {
    expect(() => searchMixes(STARTER.slice(0, 1), '#8f9a6b')).toThrow(/at least 2/)
  })

  it('allows 4-paint recipes only behind maxK=4', () => {
    const def = searchMixes(STARTER, '#7a6f5e')
    for (const r of def.results) expect(r.paint_ids.length).toBeLessThanOrEqual(3)
    const harder = searchMixes(STARTER, '#7a6f5e', { maxK: 4 })
    expect(harder.evaluated_combos).toBeGreaterThan(def.evaluated_combos)
  })

  it('meets the perf budget: full 24-tube search well under 3s', () => {
    const inv = paints.slice(0, 24)
    const t0 = performance.now()
    searchMixes(inv, '#6a8f5a')
    expect(performance.now() - t0).toBeLessThan(3000)
  })

  it('drops confidence for dark high-chroma targets (KM failure mode b)', () => {
    const out = searchMixes(STARTER, '#1a1a40')
    for (const r of out.results) expect(r.confidence_band).not.toBe('high')
  })
})

describe('gamut hints', () => {
  it('suggests white when the target is lighter than anything achievable', () => {
    const target = linearRgbToOklab(hexToLinearRgb('#ffffff'))
    const best = linearRgbToOklab(hexToLinearRgb('#b0b0b0'))
    expect(missingPigmentClass(target, best)).toMatch(/titanium white/i)
  })

  it('suggests phthalo for a saturated cyan-blue', () => {
    const target = linearRgbToOklab(hexToLinearRgb('#00a0e0'))
    const best = linearRgbToOklab(hexToLinearRgb('#6080a0'))
    expect(missingPigmentClass(target, best)).toMatch(/phthalo/i)
  })
})

describe('KS reflectance vector helper', () => {
  it('is band-count agnostic', () => {
    const r31 = new Float64Array(31).fill(0.5)
    const ks = reflectanceVecToKS(r31)
    expect(ks.length).toBe(31)
    expect(ks[15]).toBeCloseTo(0.25, 6)
  })
})
