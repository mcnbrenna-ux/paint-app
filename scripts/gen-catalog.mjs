// Writes data/catalog.csv — the versioned, hand-curated seed catalog (spec §5).
//
// ~50 core colors across 5 brands (~250 tubes) spanning the full painter's
// range — whites, yellows, oranges, reds, earths, violets, blues, greens,
// blacks — plus multi-pigment hue tubes. Colour Index codes and opacity come
// from commonly published manufacturer data. The masstone and tint
// (1 part paint : 9 parts titanium white by volume) swatch hexes are curated
// ESTIMATES standing in for the photographed swatches of the real Phase 1
// process — every row is marked source=estimated until a tube is physically
// swatched, at which point the two hex columns are replaced with measured
// values and the row flips to source=measured.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Base swatch data per core color: [name, pigments, opacity, hue_family, masstone, tint_1to9]
const CORE = [
  // Whites
  ['Titanium White', 'PW6', 'opaque', 'white', '#F5F4EF', '#F6F5F0'],
  ['Zinc White', 'PW4', 'semi-transparent', 'white', '#F7F6F2', '#F8F7F3'],
  ['Titanium Buff', 'PW6:1', 'opaque', 'white', '#D8C9A9', '#E8DFC8'],

  // Yellows
  ['Lemon Yellow', 'PY3', 'semi-transparent', 'yellow', '#F7E63A', '#FAF2AE'],
  ['Cadmium Yellow Light', 'PY35', 'opaque', 'yellow', '#FFE01A', '#FDF3B4'],
  ['Cadmium Yellow Deep', 'PY35', 'opaque', 'yellow', '#FCB514', '#FBE4A8'],
  ['Hansa Yellow Medium', 'PY74', 'semi-transparent', 'yellow', '#FFD514', '#FBEC9E'],
  ['Indian Yellow', 'PY110', 'transparent', 'yellow', '#C87A0E', '#F2D48C'],
  ['Naples Yellow Hue', 'PW6|PY35', 'opaque', 'yellow', '#EFD9A0', '#F4E6C0'],

  // Earth yellows / browns
  ['Yellow Ochre', 'PY43', 'semi-opaque', 'earth', '#C08F2E', '#E5D2A8'],
  ['Raw Sienna', 'PBr7', 'semi-transparent', 'earth', '#B07A33', '#E0C69C'],
  ['Burnt Sienna', 'PBr7', 'semi-transparent', 'earth', '#7C3A18', '#DBA78D'],
  ['Burnt Umber', 'PBr7', 'semi-transparent', 'earth', '#4A2E1C', '#C0A48D'],
  ['Raw Umber', 'PBr7', 'semi-transparent', 'earth', '#4A3A26', '#BFB4A2'],
  ['Transparent Red Oxide', 'PR101', 'transparent', 'earth', '#8C3D1A', '#DCA184'],
  ['Venetian Red', 'PR101', 'opaque', 'earth', '#A5432C', '#DFA893'],
  ['Indian Red', 'PR101', 'opaque', 'earth', '#8F3B33', '#D6A198'],

  // Oranges
  ['Cadmium Orange', 'PO20', 'opaque', 'orange', '#F26D0F', '#F9C698'],
  ['Pyrrole Orange', 'PO73', 'semi-opaque', 'orange', '#EF5510', '#F6A87E'],
  ['Transparent Orange', 'PO71', 'transparent', 'orange', '#D96018', '#F0B080'],

  // Reds
  ['Cadmium Red Light', 'PR108', 'opaque', 'red', '#D23227', '#F0B3A2'],
  ['Cadmium Red', 'PR108', 'opaque', 'red', '#C0272D', '#EEB0A6'],
  ['Pyrrole Red', 'PR254', 'semi-opaque', 'red', '#CE1220', '#F09892'],
  ['Vermilion Hue', 'PR255', 'semi-opaque', 'red', '#DE3A1E', '#F4AE94'],
  ['Alizarin Crimson', 'PR83', 'transparent', 'red', '#6E1423', '#D08298'],
  ['Permanent Alizarin', 'PR177', 'transparent', 'red', '#7A1B2C', '#D68CA0'],
  ['Quinacridone Rose', 'PV19', 'transparent', 'red', '#A81E64', '#E87CBC'],
  ['Quinacridone Magenta', 'PR122', 'transparent', 'red', '#B02579', '#E680C6'],

  // Violets
  ['Dioxazine Violet', 'PV23', 'transparent', 'violet', '#331060', '#8F5FC8'],
  ['Ultramarine Violet', 'PV15', 'semi-transparent', 'violet', '#483399', '#A79AE0'],
  ['Cobalt Violet', 'PV14', 'semi-transparent', 'violet', '#9A3FA2', '#E9CFEA'],

  // Blues
  ['Ultramarine Blue', 'PB29', 'semi-transparent', 'blue', '#1A2596', '#7A8EDC'],
  ['Cobalt Blue', 'PB28', 'semi-transparent', 'blue', '#2646AC', '#96ACE4'],
  ['Cerulean Blue', 'PB35', 'semi-opaque', 'blue', '#1F82C4', '#9CCAEC'],
  ['Phthalo Blue', 'PB15:3', 'transparent', 'blue', '#0E3050', '#2F86CC'],
  ['Phthalo Blue (Red Shade)', 'PB15:1', 'transparent', 'blue', '#14276E', '#4678D4'],
  ['Prussian Blue', 'PB27', 'transparent', 'blue', '#16222E', '#5C7E9A'],
  ['Indanthrene Blue', 'PB60', 'transparent', 'blue', '#1C2440', '#6D7FAE'],
  ['Phthalo Turquoise', 'PB16', 'transparent', 'blue', '#0C3038', '#3D9AA0'],
  ["King's Blue Hue", 'PW6|PB29', 'opaque', 'blue', '#7C97D2', '#B9C6E8'],

  // Greens
  ['Phthalo Green', 'PG7', 'transparent', 'green', '#04452B', '#28AA7C'],
  ['Phthalo Green (Yellow Shade)', 'PG36', 'transparent', 'green', '#0F4A1F', '#3FAE52'],
  ['Viridian', 'PG18', 'transparent', 'green', '#1E4B3C', '#7FB4A2'],
  ['Chromium Oxide Green', 'PG17', 'opaque', 'green', '#5A6B3C', '#A9B78C'],
  ['Sap Green', 'PG7|PY110', 'transparent', 'green', '#3A4A1E', '#8FA45C'],
  ['Terre Verte', 'PG23', 'transparent', 'green', '#5C6B55', '#CCD1C5'],
  ['Cobalt Teal', 'PG50', 'semi-opaque', 'green', '#17A9AC', '#86D6D2'],

  // Blacks & greys
  ['Ivory Black', 'PBk9', 'semi-opaque', 'black', '#1B1B1D', '#8A8E93'],
  ['Lamp Black', 'PBk6', 'opaque', 'black', '#191A1B', '#83878A'],
  ['Mars Black', 'PBk11', 'opaque', 'black', '#1A1A1A', '#85888B'],
  ["Payne's Grey", 'PBk6|PB29', 'semi-opaque', 'black', '#23293A', '#8E97AC'],
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
      'Phthalo Blue (Red Shade)': 'Winsor Blue (Red Shade)',
      'Phthalo Green': 'Winsor Green (Blue Shade)',
      'Phthalo Green (Yellow Shade)': 'Winsor Green (Yellow Shade)',
      'Quinacridone Rose': 'Permanent Rose',
      'Quinacridone Magenta': 'Permanent Magenta',
      'Pyrrole Red': 'Winsor Red',
      'Pyrrole Orange': 'Winsor Orange',
      'Dioxazine Violet': 'Winsor Violet (Dioxazine)',
      'Hansa Yellow Medium': 'Winsor Yellow',
    },
  },
  {
    name: 'Gamblin',
    delta: [4, 2, -3],
    rename: { 'Dioxazine Violet': 'Dioxazine Purple', 'Vermilion Hue': 'Napthol Scarlet' },
    // Gamblin's Cerulean is the chromium variant: same marketing name as the
    // W&N tube, different pigment code — two distinct catalog entries.
    repigment: { 'Cerulean Blue': 'PB36' },
  },
  {
    name: 'Williamsburg',
    delta: [-3, 3, 2],
    rename: { 'Ultramarine Blue': 'French Ultramarine Blue', 'Pyrrole Orange': 'Permanent Orange' },
  },
  {
    name: 'Michael Harding',
    delta: [2, -4, 4],
    rename: {
      'Phthalo Blue': 'Phthalocyanine Blue Lake',
      'Quinacridone Rose': 'Rose Madder (Quinacridone)',
      'Quinacridone Magenta': 'Magenta',
      'Pyrrole Red': 'Scarlet Lake',
    },
  },
  {
    name: 'Sennelier',
    delta: [-4, -2, -4],
    rename: {
      'Ultramarine Blue': 'French Ultramarine Blue',
      'Cadmium Yellow Light': 'Cadmium Yellow Lemon',
      'Dioxazine Violet': 'Manganese Violet Hue',
    },
  },
]

// Multi-pigment hue tubes beyond the shared core (spec §5: first-class).
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
