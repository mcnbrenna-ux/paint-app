// Writes data/catalog.csv — the versioned, hand-curated seed catalog (spec §5).
//
// 16 core colors across 5 brands (~80 tubes) weighted toward the standard
// limited palette, plus a multi-pigment hue tube. Colour Index codes and
// opacity come from commonly published manufacturer data. The masstone and
// tint (1 part paint : 9 parts titanium white by volume) swatch hexes are
// curated ESTIMATES standing in for the photographed swatches of the real
// Phase 1 process — every row is marked source=estimated until a tube is
// physically swatched, at which point the two hex columns are replaced with
// measured values and the row flips to source=measured.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Base swatch data per core color: [pigments, opacity, hue_family, masstone, tint_1to9]
const CORE = [
  ['Titanium White', 'PW6', 'opaque', 'white', '#F5F4EF', '#F6F5F0'],
  ['Ultramarine Blue', 'PB29', 'semi-transparent', 'blue', '#1E2D7D', '#8495D0'],
  ['Phthalo Blue', 'PB15:3', 'transparent', 'blue', '#0E3050', '#2F86CC'],
  ['Cerulean Blue', 'PB35', 'semi-opaque', 'blue', '#2E7BB4', '#A5CAE4'],
  ['Cobalt Blue', 'PB28', 'semi-transparent', 'blue', '#2F4DA0', '#A2B4DF'],
  ['Cadmium Yellow Light', 'PY35', 'opaque', 'yellow', '#FFE01A', '#FDF3B4'],
  ['Cadmium Yellow Deep', 'PY35', 'opaque', 'yellow', '#FCB514', '#FBE4A8'],
  ['Yellow Ochre', 'PY43', 'semi-opaque', 'earth', '#C08F2E', '#E5D2A8'],
  ['Cadmium Orange', 'PO20', 'opaque', 'orange', '#ED7524', '#F8CBA4'],
  ['Cadmium Red', 'PR108', 'opaque', 'red', '#C0272D', '#EEB0A6'],
  ['Alizarin Crimson', 'PR83', 'transparent', 'red', '#6E1423', '#D08298'],
  ['Quinacridone Rose', 'PV19', 'transparent', 'red', '#93265C', '#DE87B8'],
  ['Burnt Sienna', 'PBr7', 'semi-transparent', 'earth', '#7C3A18', '#DBA78D'],
  ['Raw Umber', 'PBr7', 'semi-transparent', 'earth', '#4A3A26', '#BFB4A2'],
  ['Ivory Black', 'PBk9', 'semi-opaque', 'black', '#1B1B1D', '#8A8E93'],
  ['Phthalo Green', 'PG7', 'transparent', 'green', '#06301F', '#2FA37E'],
]

// Brand-specific marketing names where they differ from the core name.
// Two products with the same marketing name and different pigment codes are
// distinct catalog entries (e.g. Cerulean Blue PB35 vs PB36 below).
const BRANDS = [
  {
    name: 'Winsor & Newton',
    delta: [0, 0, 0],
    rename: {
      'Ultramarine Blue': 'French Ultramarine',
      'Phthalo Blue': 'Winsor Blue (Green Shade)',
      'Phthalo Green': 'Winsor Green (Blue Shade)',
      'Quinacridone Rose': 'Permanent Rose',
    },
  },
  {
    name: 'Gamblin',
    delta: [4, 2, -3],
    rename: {},
    // Gamblin's Cerulean is the chromium variant: same marketing name as the
    // W&N tube, different pigment code — two distinct catalog entries.
    repigment: { 'Cerulean Blue': 'PB36' },
  },
  {
    name: 'Williamsburg',
    delta: [-3, 3, 2],
    rename: { 'Ultramarine Blue': 'French Ultramarine Blue' },
  },
  {
    name: 'Michael Harding',
    delta: [2, -4, 4],
    rename: { 'Phthalo Blue': 'Phthalocyanine Blue Lake', 'Quinacridone Rose': 'Magenta' },
  },
  {
    name: 'Sennelier',
    delta: [-4, -2, -4],
    rename: { 'Ultramarine Blue': 'French Ultramarine Blue', 'Cadmium Yellow Light': 'Cadmium Yellow Lemon' },
  },
]

// Multi-pigment tubes are first-class (spec §5).
const EXTRA = [
  ['Winsor & Newton', 'Cerulean Blue Hue', 'PB15:3|PW6', 'opaque', 'blue', '#3E86BC', '#ACCEE6'],
]

function shiftHex(hex, [dr, dg, db]) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp(((n >> 16) & 0xff) + dr)
  const g = clamp(((n >> 8) & 0xff) + dg)
  const b = clamp((n & 0xff) + db)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`
}

const rows = [
  'brand,product_name,pigment_ids,opacity,hue_family,masstone_hex,tint_hex,source,confidence',
]
for (const brand of BRANDS) {
  for (const [name, pigments, opacity, family, mass, tint] of CORE) {
    const productName = brand.rename[name] ?? name
    const pig = brand.repigment?.[name] ?? pigments
    rows.push(
      [
        brand.name,
        productName,
        pig,
        opacity,
        family,
        shiftHex(mass, brand.delta),
        shiftHex(tint, brand.delta.map((d) => Math.round(d / 2))),
        'estimated',
        '0.4',
      ].join(','),
    )
  }
}
for (const r of EXTRA) {
  rows.push([...r, 'estimated', '0.4'].join(','))
}

mkdirSync(join(root, 'data'), { recursive: true })
writeFileSync(join(root, 'data', 'catalog.csv'), rows.join('\n') + '\n')
console.log(`Wrote data/catalog.csv with ${rows.length - 1} tubes`)
