// Phase 1 validation (spec §8): every paint has >= 1 pigment code and a
// strength value; catalog invariants the engine depends on.

import { describe, expect, it } from 'vitest'
import catalog from './catalog.json'

describe('seed catalog', () => {
  it('every paint has at least one pigment code and a tinting strength', () => {
    for (const p of catalog.paints) {
      expect(p.pigment_ids.length, p.id).toBeGreaterThanOrEqual(1)
      expect(p.tinting_strength, p.id).toBeGreaterThan(0)
    }
  })

  it('every paint has K/S coefficients for every band', () => {
    for (const p of catalog.paints) {
      expect(p.ks.length, p.id).toBe(catalog.bands)
      expect(p.ks.every((v: number) => Number.isFinite(v) && v >= 0), p.id).toBe(true)
    }
  })

  it('paint ids are unique', () => {
    const ids = catalog.paints.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every referenced pigment code exists in the pigment table', () => {
    const known = new Set(catalog.pigments.map((p) => p.id))
    for (const p of catalog.paints) {
      for (const pid of p.pigment_ids) expect(known.has(pid), `${p.id} -> ${pid}`).toBe(true)
    }
  })

  it('same marketing name with different pigment codes yields distinct entries', () => {
    const ceruleans = catalog.paints.filter((p) => p.product_name === 'Cerulean Blue')
    const codes = new Set(ceruleans.map((p) => p.pigment_ids.join('|')))
    expect(ceruleans.length).toBeGreaterThanOrEqual(2)
    expect(codes.size).toBeGreaterThanOrEqual(2)
  })

  it('multi-pigment tubes are first-class', () => {
    expect(catalog.paints.some((p) => p.pigment_ids.length > 1)).toBe(true)
  })

  it('titanium white is the tinting-strength reference', () => {
    const whites = catalog.paints.filter((p) => p.pigment_ids.length === 1 && p.pigment_ids[0] === 'PW6')
    expect(whites.length).toBeGreaterThan(0)
    for (const w of whites) expect(w.tinting_strength).toBe(1.0)
  })

  it('covers ~80 tubes across 5 brands (spec §5 target)', () => {
    expect(catalog.paints.length).toBeGreaterThanOrEqual(75)
    expect(new Set(catalog.paints.map((p) => p.brand)).size).toBe(5)
  })
})
