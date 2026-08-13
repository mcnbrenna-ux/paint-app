// Swatch-fitting script (spec §5, Phase 1): reads data/catalog.csv and fits
// per-tube 3-band K/S coefficients plus a relative tinting-strength factor
// from the masstone and 1:9-in-white tint swatches, then writes
// src/data/catalog.json (paints + pigments) consumed by the app and CLI.
//
// Fit model (single-constant KM, per band):
//   KS_paint = (1 - R_mass)^2 / 2·R_mass
//   The tint mixes 1 part paint (strength s) with 9 parts white (s = 1), so
//   KS_tint = (s·KS_paint + 9·KS_white) / (s + 9)  →  solve for s per band,
//   average across bands weighted by the paint/white K/S contrast.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hexToLinearRgb } from '../src/engine/color.ts'
import { reflectanceVecToKS } from '../src/engine/km.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PIGMENTS = {
  // Whites
  PW6: ['Titanium White', 'opaque', 'Rutile titanium dioxide. The tinting-strength reference (s = 1.0).'],
  PW4: ['Zinc White', 'semi-transparent', 'Zinc oxide; weaker, more transparent white for tints and glazes.'],
  'PW6:1': ['Titanium Buff', 'opaque', 'Unbleached titanium dioxide; warm off-white.'],
  // Yellows
  PY3: ['Hansa Yellow Light (Lemon)', 'semi-transparent', 'Arylide yellow, green-leaning lemon.'],
  PY35: ['Cadmium Yellow', 'opaque', 'Cadmium zinc sulfide, light through deep shades.'],
  PY74: ['Hansa Yellow Medium', 'semi-transparent', 'Arylide yellow, mid warmth.'],
  PY110: ['Indian Yellow (Isoindolinone)', 'transparent', 'Deep amber glazing yellow.'],
  PY43: ['Yellow Ochre', 'semi-opaque', 'Natural iron oxide.'],
  // Oranges
  PO20: ['Cadmium Orange', 'opaque', 'Cadmium sulfoselenide.'],
  PO73: ['Pyrrole Orange', 'semi-opaque', 'High-chroma DPP orange.'],
  PO71: ['Transparent Pyrrole Orange', 'transparent', 'Glazing orange.'],
  // Reds
  PR108: ['Cadmium Red', 'opaque', 'Cadmium sulfoselenide.'],
  PR254: ['Pyrrole Red', 'semi-opaque', 'High-chroma DPP red; 3-band model is weakest here.'],
  PR255: ['Pyrrole Scarlet', 'semi-opaque', 'Lighter, warmer DPP red.'],
  PR83: ['Alizarin Crimson', 'transparent', 'Fugitive lake; kept for its mixing behavior.'],
  PR177: ['Anthraquinone Red', 'transparent', 'Permanent alizarin-style crimson.'],
  PV19: ['Quinacridone Rose', 'transparent', 'High-chroma organic; 3-band model is weakest here.'],
  PR122: ['Quinacridone Magenta', 'transparent', 'High-chroma organic; 3-band model is weakest here.'],
  PR101: ['Synthetic Iron Oxide Red', 'opaque', 'Covers venetian/indian red and transparent red oxide.'],
  // Earths
  PBr7: ['Natural Iron Oxide (Sienna/Umber)', 'semi-transparent', 'Covers siennas and umbers.'],
  // Violets
  PV23: ['Dioxazine Violet', 'transparent', 'Very strong glazing violet; 3-band model is weakest here.'],
  PV15: ['Ultramarine Violet', 'semi-transparent', 'Muted mineral violet.'],
  PV14: ['Cobalt Violet', 'semi-transparent', 'Weak-tinting mineral violet.'],
  // Blues
  PB29: ['Ultramarine Blue', 'semi-transparent', 'Warm, red-leaning blue. Moderate tinter.'],
  PB28: ['Cobalt Blue', 'semi-transparent', 'Cobalt aluminate.'],
  PB35: ['Cerulean Blue', 'semi-opaque', 'Genuine cerulean, tin-cobalt oxide.'],
  PB36: ['Cerulean Blue (Chromium)', 'semi-opaque', 'Cobalt chromite; greener and stronger than PB35.'],
  'PB15:3': ['Phthalo Blue (Green Shade)', 'transparent', 'Very high tinting strength; 3-band model is weakest here.'],
  'PB15:1': ['Phthalo Blue (Red Shade)', 'transparent', 'Warmer phthalo; very high tinting strength.'],
  PB27: ['Prussian Blue', 'transparent', 'Deep, strong iron blue.'],
  PB60: ['Indanthrene Blue', 'transparent', 'Muted, deep blue; less green than phthalo.'],
  PB16: ['Phthalo Turquoise', 'transparent', 'Metal-free phthalo, cyan-leaning.'],
  // Greens
  PG7: ['Phthalo Green (Blue Shade)', 'transparent', 'Very high tinting strength; 3-band model is weakest here.'],
  PG36: ['Phthalo Green (Yellow Shade)', 'transparent', 'Warmer phthalo green.'],
  PG18: ['Viridian', 'transparent', 'Hydrated chromium oxide; cool, weak-tinting green.'],
  PG17: ['Chromium Oxide Green', 'opaque', 'Dense, muted opaque green.'],
  PG23: ['Terre Verte (Green Earth)', 'transparent', 'Very weak, muted earth green.'],
  PG50: ['Cobalt Teal', 'semi-opaque', 'Cobalt titanate; bright mineral teal.'],
  // Blacks
  PBk9: ['Ivory Black', 'semi-opaque', 'Bone black; slow drier.'],
  PBk6: ['Lamp Black', 'opaque', 'Carbon black; cool and strong.'],
  PBk11: ['Mars Black', 'opaque', 'Iron oxide black; fast drier, strong.'],
}

const csv = readFileSync(join(root, 'data', 'catalog.csv'), 'utf8').trim().split('\n')
const header = csv[0].split(',')
const col = (name) => header.indexOf(name)

const paints = []
const pigmentKSSamples = new Map()

// White K/S reference per brand (each brand's tints are ladders against its own white).
const whiteKSByBrand = new Map()
for (const line of csv.slice(1)) {
  const f = line.split(',')
  if (f[col('pigment_ids')] === 'PW6') {
    whiteKSByBrand.set(f[col('brand')], reflectanceVecToKS(hexToLinearRgb(f[col('masstone_hex')])))
  }
}

for (const line of csv.slice(1)) {
  const f = line.split(',')
  const brand = f[col('brand')]
  const pigmentIds = f[col('pigment_ids')].split('|')
  const ksPaint = reflectanceVecToKS(hexToLinearRgb(f[col('masstone_hex')]))
  const ksTint = reflectanceVecToKS(hexToLinearRgb(f[col('tint_hex')]))
  const ksWhite = whiteKSByBrand.get(brand)
  if (!ksWhite) throw new Error(`No titanium white reference for brand ${brand}`)

  // Solve KS_tint·(s+9) = s·KS_paint + 9·KS_white per band.
  // White-led tubes are special-cased: their tint swatch is nearly identical
  // to their masstone, which makes the solve numerically meaningless.
  let s
  if (pigmentIds[0].startsWith('PW')) {
    // Zinc white is a famously weak tinter; other whites sit at the reference.
    s = pigmentIds[0] === 'PW4' ? 0.35 : 1.0
  } else {
    let num = 0
    let den = 0
    for (let b = 0; b < 3; b++) {
      const contrast = ksPaint[b] - ksWhite[b]
      const dPaint = ksTint[b] - ksPaint[b]
      if (Math.abs(dPaint) < 1e-6 || Math.abs(contrast) < 1e-4) continue
      const sBand = (9 * (ksWhite[b] - ksTint[b])) / dPaint
      if (!Number.isFinite(sBand) || sBand <= 0) continue
      num += sBand * Math.abs(contrast)
      den += Math.abs(contrast)
    }
    s = den > 0 ? num / den : 1.0
    s = Math.min(6, Math.max(0.05, s))
  }

  const id = `${brand} ${f[col('product_name')]}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  paints.push({
    id,
    brand,
    product_name: f[col('product_name')],
    medium: 'oil',
    pigment_ids: pigmentIds,
    opacity: f[col('opacity')],
    tinting_strength: Number(s.toFixed(3)),
    ks: [...ksPaint].map((v) => Number(v.toFixed(5))),
    masstone_hex: f[col('masstone_hex')],
    source: f[col('source')],
    confidence: Number(f[col('confidence')]),
    hue_family: f[col('hue_family')],
  })

  if (pigmentIds.length === 1) {
    const list = pigmentKSSamples.get(pigmentIds[0]) ?? []
    list.push(ksPaint)
    pigmentKSSamples.set(pigmentIds[0], list)
  }
}

// Pigment-level K/S = average across single-pigment tubes carrying it. This is
// the canonical fallback for user-added tubes matched only by pigment code.
const pigments = Object.entries(PIGMENTS).map(([id, [common_name, transparency, notes]]) => {
  const samples = pigmentKSSamples.get(id) ?? []
  const ks = [0, 0, 0]
  for (const sample of samples) for (let b = 0; b < 3; b++) ks[b] += sample[b] / samples.length
  return {
    id,
    common_name,
    transparency,
    ks_coefficients: samples.length ? ks.map((v) => Number(v.toFixed(5))) : [],
    notes,
  }
})

// Physically-measured overrides, applied after the estimate fit. Provenance:
// owner's Phase A photo set (2026-08-08) — five swatches (titanium-white
// reference + four declared mixes) shot under window / lamp / mixed light and
// white-patch calibrated (±6.2 dE00 compounded band; patch colors read
// visually from uploaded photos, not pixel-sampled). Cerulean K/S derived
// from the 3:1-in-white tint swatch with strength anchored at 0.10 (weak
// tinter, per its real-world reputation); the K/S triple is the effective
// value single-constant KM needs to reproduce that measurement, not a claim
// about the tube's masstone appearance. Sienna strength fitted from the
// 2:1-in-white swatch. Held-out validation (2W:1C:1S mix) improved from
// dE00 ~30 to ~9-14. Confidence 0.6 reflects the visual-read uncertainty.
// Phase A pixel data later showed the capture pipeline is lighting-
// inconsistent (docs/phase-a-results.md), so these stay 'estimated': the
// directional corrections are supported under every lighting, the absolute
// values are not certifiable.
const MEASURED_OVERRIDES = {
  'winsor-newton-cerulean-blue': {
    ks: [6.354, 1.831, 0.063],
    tinting_strength: 0.1,
    source: 'estimated',
    confidence: 0.5,
  },
  'winsor-newton-burnt-sienna': {
    tinting_strength: 0.16,
    source: 'estimated',
    confidence: 0.5,
  },
}
for (const paint of paints) {
  const override = MEASURED_OVERRIDES[paint.id]
  if (override) Object.assign(paint, override)
}

const catalog = {
  version: 1,
  bands: 3,
  generated_from: 'data/catalog.csv',
  pigments,
  paints,
}

mkdirSync(join(root, 'src', 'data'), { recursive: true })
writeFileSync(join(root, 'src', 'data', 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')

console.log(`Fitted ${paints.length} paints, ${pigments.length} pigments -> src/data/catalog.json`)
for (const p of paints.filter((p) => p.brand === 'Winsor & Newton')) {
  console.log(`  s=${p.tinting_strength.toFixed(2).padStart(5)}  ${p.product_name}`)
}
