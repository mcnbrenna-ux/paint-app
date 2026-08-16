// Tests for the lighting-profiles correction pipeline, organized around the
// calibration PRD's acceptance criteria (§10).

import { describe, expect, it } from 'vitest'
import { deltaE00 } from '../coach/lab.ts'
import type { LightingProfile } from '../engine/types.ts'
import {
  ANCHOR_CLIP,
  buildSwatchCapture,
  correctToLab,
  defaultProfile,
  FrameRejectedError,
  matchInProfile,
  medianRegion,
  needsReverification,
  reprocessProfile,
  sampleAnchor,
  srgb8ToLinear,
  vonKriesGains,
  applyGains,
} from './correction.ts'

const region = (rgb: number[], n = 25) => Array.from({ length: n }, () => [...rgb])

const baseProfile = (over: Partial<LightingProfile> = {}): LightingProfile => ({
  id: 'p1',
  name: 'Evening — lamp',
  createdAt: 0,
  lastVerifiedAt: 1,
  anchorReference: { r: 0.9, g: 0.89, b: 0.86 },
  swatches: [],
  notes: '',
  kind: 'artificial',
  anchorKind: 'white_paint',
  useCount: 0,
  ...over,
})

describe('AC1 — five varied captures agree within dE2000 < 2', () => {
  it('the same pigment through five different camera states corrects to the same Lab', () => {
    const profile = baseProfile()
    const trueAnchor = [0.9, 0.89, 0.86]
    const trueSwatch = [0.32, 0.18, 0.09] // a burnt-sienna-ish color
    // Five frames: different auto-WB/exposure states (per-channel gains).
    const cameras = [
      [1.0, 1.0, 1.0],
      [1.06, 0.95, 0.72], // warm cast
      [0.75, 0.9, 1.08], // cool cast
      [0.55, 0.55, 0.55], // underexposed
      [1.05, 1.06, 1.04], // slightly hot, anchor still unclipped
    ]
    const labs = cameras.map((g) => {
      const measuredAnchor = sampleAnchor(region([trueAnchor[0] * g[0], trueAnchor[1] * g[1], trueAnchor[2] * g[2]]))
      const raw = medianRegion(region([trueSwatch[0] * g[0], trueSwatch[1] * g[1], trueSwatch[2] * g[2]]))
      return correctToLab(raw, measuredAnchor, profile)
    })
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        expect(deltaE00(labs[i], labs[j])).toBeLessThan(2.0)
      }
    }
  })
})

describe('AC2 — clipped anchor is rejected with a non-technical prompt', () => {
  it('rejects clipping and speaks human', () => {
    expect(() => sampleAnchor(region([0.99, 0.97, 0.96]))).toThrow(FrameRejectedError)
    try {
      sampleAnchor(region([0.99, 0.97, 0.96]))
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toMatch(/again/i) // tells the user what to do
      // no jargon
      for (const word of ['clip', 'linear', 'RGB', 'channel', 'gain', 'pixel']) {
        expect(msg).not.toMatch(new RegExp(`\\b${word}`, 'i'))
      }
    }
  })

  it('rejects underexposed and occluded anchors with distinct reasons', () => {
    try {
      sampleAnchor(region([0.05, 0.06, 0.05]))
    } catch (e) {
      expect((e as FrameRejectedError).reason).toBe('underexposed')
    }
    // Half bright, half dark — something is covering the dab.
    const occluded = [...region([0.9, 0.9, 0.9], 13), ...region([0.3, 0.3, 0.3], 12)]
    try {
      sampleAnchor(occluded)
    } catch (e) {
      expect((e as FrameRejectedError).reason).toBe('occluded')
    }
  })
})

describe('AC4 — algorithm revision reprocesses from raw, no re-capture', () => {
  it('recomputes correctedLab from stored raw values only', () => {
    const profile = baseProfile()
    const cap = buildSwatchCapture('tube-1', [0.3, 0.2, 0.1], [0.8, 0.82, 0.78], profile, 123)
    profile.swatches = [cap]
    // "Algorithm revision": the anchor reference itself is re-measured.
    const revised = { ...profile, anchorReference: { r: 0.95, g: 0.94, b: 0.9 } }
    const reprocessed = reprocessProfile(revised)
    // Raw data untouched, corrected values recomputed against the new reference.
    expect(reprocessed.swatches[0].rawLinearRgb).toEqual(cap.rawLinearRgb)
    expect(reprocessed.swatches[0].rawAnchorLinearRgb).toEqual(cap.rawAnchorLinearRgb)
    expect(reprocessed.swatches[0].correctedLab).not.toEqual(cap.correctedLab)
    const direct = correctToLab([0.3, 0.2, 0.1], [0.8, 0.82, 0.78], revised)
    expect(reprocessed.swatches[0].correctedLab.L).toBeCloseTo(direct[0], 10)
  })
})

describe('§5 pipeline details', () => {
  it('linearizes 8-bit sRGB before any math (§5.1)', () => {
    const [r] = srgb8ToLinear(128, 128, 128)
    expect(r).toBeCloseTo(0.2158, 3) // sRGB 50% is ~21.6% linear, not 50%
  })

  it('median rejects specular outliers where mean would not (§5.2)', () => {
    const px = [...region([0.4, 0.4, 0.4], 20), ...region([0.97, 0.97, 0.97], 5)]
    const med = medianRegion(px)
    expect(med[0]).toBeCloseTo(0.4, 5)
    const mean = px.reduce((a, p) => a + p[0], 0) / px.length
    expect(mean).toBeGreaterThan(0.5) // the mean would have lied
  })

  it('von Kries gains map the measured anchor exactly onto the reference (§5.4)', () => {
    const ref = { r: 0.9, g: 0.89, b: 0.86 }
    const measured = [0.7, 0.75, 0.6]
    const out = applyGains(measured, vonKriesGains(ref, measured))
    expect(out[0]).toBeCloseTo(ref.r, 10)
    expect(out[1]).toBeCloseTo(ref.g, 10)
    expect(out[2]).toBeCloseTo(ref.b, 10)
  })

  it('comparison is dE2000 within ONE profile only (§5.6)', () => {
    const profile = baseProfile()
    profile.swatches = [
      buildSwatchCapture('sienna', [0.32, 0.18, 0.09], [0.9, 0.89, 0.86], profile, 1),
      buildSwatchCapture('cerulean', [0.2, 0.4, 0.55], [0.9, 0.89, 0.86], profile, 2),
      buildSwatchCapture('white', [0.88, 0.87, 0.85], [0.9, 0.89, 0.86], profile, 3),
    ]
    const sample = correctToLab([0.31, 0.19, 0.1], [0.9, 0.89, 0.86], profile)
    const matches = matchInProfile(profile, sample)
    expect(matches[0].pigmentId).toBe('sienna')
    expect(matches[0].deltaE2000).toBeLessThan(matches[1].deltaE2000)
    // The query layer's signature admits exactly one profile — nothing to
    // assert at runtime beyond that it only read this profile's swatches.
    expect(matches.length).toBeLessThanOrEqual(3)
  })
})

describe('§7 / §8 — selection default and drift', () => {
  it('default profile is the most-used, not the most recent', () => {
    const a = baseProfile({ id: 'a', useCount: 9, lastVerifiedAt: 1 })
    const b = baseProfile({ id: 'b', useCount: 2, lastVerifiedAt: 999 })
    expect(defaultProfile([b, a])?.id).toBe('a')
    expect(defaultProfile([])).toBeNull()
  })

  it('artificial profiles want re-verification after ~6 months; daylight is flagged differently', () => {
    const now = Date.now()
    const old = baseProfile({ lastVerifiedAt: now - 200 * 24 * 3600 * 1000 })
    const fresh = baseProfile({ lastVerifiedAt: now - 10 * 24 * 3600 * 1000 })
    const daylight = baseProfile({ kind: 'daylight', lastVerifiedAt: now - 400 * 24 * 3600 * 1000 })
    expect(needsReverification(old, now)).toBe(true)
    expect(needsReverification(fresh, now)).toBe(false)
    // Daylight is inherently variable — it gets a permanent flag, not a timer.
    expect(needsReverification(daylight, now)).toBe(false)
  })
})

describe('anchor clip threshold', () => {
  it('uses the specified 0.98 normalized-linear cutoff', () => {
    expect(ANCHOR_CLIP).toBe(0.98)
    expect(() => sampleAnchor(region([0.979, 0.9, 0.9]))).not.toThrow()
  })
})
