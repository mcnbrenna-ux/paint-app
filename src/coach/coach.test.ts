import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import catalog from '../data/catalog.json'
import type { Paint } from '../engine/types.ts'
import {
  CAPTURE_REJECT_DE,
  CaptureRejectedError,
  COLORCHECKER_LAB,
  calibrateColorChecker,
  calibrateGrayCard,
  GRAY_CARD_ERROR_FLOOR,
} from './calibrate.ts'
import { diagnose, predictDeclaredMix } from './diagnose.ts'
import { compoundedError } from './errors.ts'
import { extractRegion, hasBlownHighlights } from './extract.ts'
import { compositePixel, layerAlpha } from './glaze.ts'
import { evaluateRule, validateRule, type GuidanceRule } from './guidance.ts'
import { deltaE00, labD50ToLinearRgb, linearRgbToLabD50 } from './lab.ts'

const paints = catalog.paints as Paint[]
const byName = (n: string) => paints.find((p) => p.brand === 'Winsor & Newton' && p.product_name === n)!

describe('CIEDE2000', () => {
  // Published test pairs from Sharma, Wu & Dalal (2005).
  const cases: [readonly [number, number, number], readonly [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
  ]
  it('matches published Sharma test pairs', () => {
    for (const [a, b, expected] of cases) {
      expect(deltaE00(a, b)).toBeCloseTo(expected, 3)
    }
  })
  it('is zero for identical colors and symmetric', () => {
    expect(deltaE00([50, 10, -10], [50, 10, -10])).toBe(0)
    expect(deltaE00([40, 5, 5], [60, -5, 20])).toBeCloseTo(deltaE00([60, -5, 20], [40, 5, 5]), 10)
  })
})

describe('Lab(D50) conversions', () => {
  it('round-trips Lab through linear RGB for in-gamut colors', () => {
    for (const lab of [[50, 20, 10], [70, -15, 30], [30, 5, -25]] as const) {
      const rt = linearRgbToLabD50(labD50ToLinearRgb(lab))
      expect(deltaE00(lab, rt)).toBeLessThan(0.01)
    }
  })
})

describe('calibration pipeline', () => {
  // Synthetic camera: known channel gains + exposure error applied to the
  // reference patches. The pipeline must recover them.
  const distort = (rgb: number[], gains: number[]) => rgb.map((v, i) => v * gains[i])
  const referenceRgb = COLORCHECKER_LAB.map((lab) => [...labD50ToLinearRgb(lab)].map((v) => Math.max(0, v)))

  it('ColorChecker CCM recovers a channel-gain cast within tolerance', () => {
    const gains = [1.25, 1.0, 0.7] // warm cast + underexposed blue
    const observed = referenceRgb.map((p) => distort(p, gains))
    const cal = calibrateColorChecker(observed)
    expect(cal.captureError).toBeLessThan(1.0)
    // A mid-gray shot through the same camera comes back neutral.
    const corrected = cal.correct(distort([0.18, 0.18, 0.18], gains))
    const lab = linearRgbToLabD50(corrected)
    expect(Math.hypot(lab[1], lab[2])).toBeLessThan(1.5)
  })

  it('rejects a capture whose residual exceeds the gate', () => {
    // Non-linear channel crush the linear pipeline cannot fully correct.
    const observed = referenceRgb.map((p) => [Math.pow(p[0], 2.6), Math.pow(p[1], 0.4), p[2] * 0.15 + 0.35])
    expect(() => calibrateColorChecker(observed)).toThrow(CaptureRejectedError)
    try {
      calibrateColorChecker(observed)
    } catch (e) {
      expect((e as CaptureRejectedError).captureError).toBeGreaterThan(CAPTURE_REJECT_DE)
    }
  })

  it('gray card neutralizes a cast but reports the honesty floor, never zero', () => {
    const gains = [1.3, 1.0, 0.8]
    const cal = calibrateGrayCard(distort([0.18, 0.18, 0.18], gains))
    expect(cal.captureError).toBe(GRAY_CARD_ERROR_FLOOR)
    const lab = linearRgbToLabD50(cal.correct(distort([0.18, 0.18, 0.18], gains)))
    expect(Math.hypot(lab[1], lab[2])).toBeLessThan(0.5)
  })
})

describe('extraction', () => {
  it('rejects specular outliers and medians the remainder', () => {
    const cal = calibrateGrayCard([0.18, 0.18, 0.18])
    const base = Array.from({ length: 45 }, () => [0.2, 0.3, 0.25])
    const speculars = Array.from({ length: 5 }, () => [0.99, 0.99, 0.99])
    const out = extractRegion([...base, ...speculars], cal)
    expect(out.rejected_specular).toBeGreaterThanOrEqual(5)
    expect(out.linear_rgb[0]).toBeCloseTo(0.2, 2)
    expect(out.captureError).toBe(cal.captureError)
  })

  it('flags blown-highlight clusters for re-shoot', () => {
    const ok = Array.from({ length: 50 }, () => [0.4, 0.4, 0.4])
    expect(hasBlownHighlights(ok)).toBe(false)
    const blown = [...ok.slice(0, 40), ...Array.from({ length: 10 }, () => [0.995, 0.99, 0.99])]
    expect(hasBlownHighlights(blown)).toBe(true)
  })
})

describe('compounded error model', () => {
  it('combines in quadrature, labeled an estimate, never below components', () => {
    const band = compoundedError(4)
    expect(band.label).toBe('estimate')
    expect(band.value).toBeCloseTo(Math.sqrt(16 + 4 + 9), 5)
    expect(band.value).toBeGreaterThan(4)
  })
})

describe('diagnosis', () => {
  const mix = {
    components: [
      { paint: byName('Titanium White'), parts: 8 },
      { paint: byName('French Ultramarine'), parts: 4 },
    ],
  }
  it('inside the error band produces no hypotheses', () => {
    const predicted = predictDeclaredMix(mix)
    const d = diagnose(mix, predicted, 3.5)
    expect(d.exceeds_band).toBe(false)
    expect(d.hypotheses).toEqual([])
  })
  it('actual lighter + duller ranks dilution/substrate first (closed list)', () => {
    const p = predictDeclaredMix(mix)
    const actual = [p[0] + 12, p[1] * 0.4, p[2] * 0.4] as const
    const d = diagnose(mix, actual, 3.5)
    expect(d.exceeds_band).toBe(true)
    expect(d.hypotheses[0]).toBe('medium_dilution')
    expect(d.hypotheses).toContain('substrate_show_through')
  })
  it('darker + more chromatic ranks proportion drift first', () => {
    const p = predictDeclaredMix(mix)
    const actual = [p[0] - 12, p[1] * 2 - 4, p[2] * 2 - 6] as const
    const d = diagnose(mix, actual, 3.5)
    expect(d.hypotheses[0]).toBe('proportion_drift')
  })
})

describe('layer preview composite', () => {
  const glazeSpec = {
    recipe: [{ paint: byName('Alizarin Crimson'), parts: 1 }],
    thicknessClass: 'glaze' as const,
    mediumLoad: 0.5,
  }
  it('opaque returns the flat mix color regardless of substrate', () => {
    const spec = { ...glazeSpec, thicknessClass: 'opaque' as const }
    const a = compositePixel([0.05, 0.05, 0.05], spec)
    const b = compositePixel([0.9, 0.9, 0.9], spec)
    expect(a).toEqual(b)
  })
  it('a glaze darkens a light substrate toward the layer color without replacing it', () => {
    const light: [number, number, number] = [0.8, 0.8, 0.8]
    const out = compositePixel(light, glazeSpec)
    expect(out[0]).toBeLessThan(light[0]) // darkened
    expect(out[0]).toBeGreaterThan(out[1]) // pulled red-ward
    const opaque = compositePixel(light, { ...glazeSpec, thicknessClass: 'opaque' })
    expect(out[1]).toBeGreaterThan(opaque[1]) // substrate still contributes
  })
  it('more medium load lowers the layer weight', () => {
    expect(layerAlpha({ ...glazeSpec, mediumLoad: 1 })).toBeLessThan(layerAlpha({ ...glazeSpec, mediumLoad: 0 }))
  })
})

describe('guidance content', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'guidance')
  const rules = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GuidanceRule)

  it('ships exactly the six authored transitions of the classical indirect workflow', () => {
    const pairs = new Set(rules.map((r) => `${r.fromStage}->${r.toStage}`))
    expect(pairs).toEqual(
      new Set([
        'TONED_GROUND->UNDERPAINTING',
        'UNDERPAINTING->BLOCK_IN',
        'BLOCK_IN->FIRST_PAINTING',
        'FIRST_PAINTING->GLAZING',
        'FIRST_PAINTING->SCUMBLING',
        'GLAZING->DETAILS_FINAL',
      ]),
    )
  })

  it('every rule validates against the schema', () => {
    for (const r of rules) {
      expect(validateRule(r), r.id).toEqual([])
    }
  })

  it('drying windows are ranges, never a single number', () => {
    for (const r of rules) {
      if (r.dryingWindow) expect(r.dryingWindow.max_days).toBeGreaterThan(r.dryingWindow.min_days)
    }
  })

  it('fat-over-lean blocks a leaner target layer', () => {
    const glazing = rules.find((r) => r.toStage === 'GLAZING')!
    // Declared current stage GLAZING (fat 3), target rule's toStage fat also 3
    // -> no block; but simulate a declared fatter current layer than a lean
    // target by evaluating the underpainting rule from FIRST_PAINTING.
    const underRule = rules.find((r) => r.toStage === 'UNDERPAINTING')!
    const blocked = evaluateRule(underRule, { currentStage: 'FIRST_PAINTING', layerDry: true })
    expect(blocked.blocking.some((b) => b.includes('Fat over lean'))).toBe(true)
    const ok = evaluateRule(glazing, { currentStage: 'FIRST_PAINTING', layerDry: true })
    expect(ok.blocking).toEqual([])
  })

  it('undeclared dryness blocks rules that require it', () => {
    const rule = rules.find((r) => r.preconditions.includes('layerDrynessDeclared'))!
    const evaln = evaluateRule(rule, { currentStage: rule.fromStage, layerDry: false })
    expect(evaln.blocking.length).toBeGreaterThan(0)
  })
})
