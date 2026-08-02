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
  PW6: ['Titanium White', 'opaque', 'Rutile titanium dioxide. The tinting-strength reference (s = 1.0).'],
  PB29: ['Ultramarine Blue', 'semi-transparent', 'Warm, red-leaning blue. Moderate tinter.'],
  'PB15:3': ['Phthalo Blue (Green Shade)', 'transparent', 'Very high tinting strength; 3-band model is weakest here.'],
  PB35: ['Cerulean Blue', 'semi-opaque', 'Genuine cerulean, tin-cobalt oxide.'],
  PB36: ['Cerulean Blue (Chromium)', 'semi-opaque', 'Cobalt chromite; greener and stronger than PB35.'],
  PB28: ['Cobalt Blue', 'semi-transparent', 'Cobalt aluminate.'],
  PY35: ['Cadmium Yellow', 'opaque', 'Cadmium zinc sulfide, light through deep shades.'],
  PY43: ['Yellow Ochre', 'semi-opaque', 'Natural iron oxide.'],
  PO20: ['Cadmium Orange', 'opaque', 'Cadmium sulfoselenide.'],
  PR108: ['Cadmium Red', 'opaque', 'Cadmium sulfoselenide.'],
  PR83: ['Alizarin Crimson', 'transparent', 'Fugitive lake; kept for its mixing behavior.'],
  PV19: ['Quinacridone Rose', 'transparent', 'High-chroma organic; 3-band model is weakest here.'],
  PBr7: ['Natural Iron Oxide (Sienna/Umber)', 'semi-transparent', 'Covers burnt sienna, raw/burnt umber.'],
  PBk9: ['Ivory Black', 'semi-opaque', 'Bone black; slow drier.'],
  PG7: ['Phthalo Green (Blue Shade)', 'transparent', 'Very high tinting strength; 3-band model is weakest here.'],
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
  let s
  if (pigmentIds.length === 1 && pigmentIds[0] === 'PW6') {
    s = 1.0
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
