#!/usr/bin/env node
// Phase 0 engine harness (spec §8): takes a target hex and a JSON inventory,
// prints ranked recipes. No UI involved — this is how predictions get tested
// against hand-mixed physical swatches.
//
// Usage:
//   node cli/mix.mjs '#6a8f5a'                        # starter-palette inventory
//   node cli/mix.mjs '#6a8f5a' inventory.json         # ids or paint objects
//   node cli/mix.mjs '#6a8f5a' --all                  # whole catalog as inventory
//   node cli/mix.mjs '#6a8f5a' --harder               # allow 4-paint recipes
//
// inventory.json is either an array of catalog paint ids, or an array of full
// Paint objects (see src/engine/types.ts) for tubes outside the catalog.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchMixes, MIX_IT_DE, ACHIEVABLE_DE } from '../src/engine/search.ts'
import { CONFIDENCE_LABEL } from '../src/engine/confidence.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(join(root, 'src', 'data', 'catalog.json'), 'utf8'))

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))

const targetHex = positional[0]
if (!targetHex || !/^#?[0-9a-f]{6}$/i.test(targetHex)) {
  console.error('Usage: node cli/mix.mjs <target-hex> [inventory.json] [--all] [--harder]')
  process.exit(2)
}

const STARTER = [
  'winsor-newton-titanium-white',
  'winsor-newton-french-ultramarine',
  'winsor-newton-cerulean-blue',
  'winsor-newton-cadmium-yellow-light',
  'winsor-newton-yellow-ochre',
  'winsor-newton-cadmium-red',
  'winsor-newton-alizarin-crimson',
  'winsor-newton-burnt-sienna',
  'winsor-newton-raw-umber',
  'winsor-newton-ivory-black',
]

let paints
if (flags.has('--all')) {
  paints = catalog.paints
} else if (positional[1]) {
  const inv = JSON.parse(readFileSync(positional[1], 'utf8'))
  paints = inv.map((entry) => {
    if (typeof entry === 'string') {
      const p = catalog.paints.find((c) => c.id === entry)
      if (!p) throw new Error(`Unknown catalog paint id: ${entry}`)
      return p
    }
    return entry
  })
} else {
  paints = STARTER.map((id) => catalog.paints.find((c) => c.id === id))
}

const hex = targetHex.startsWith('#') ? targetHex : `#${targetHex}`
const t0 = performance.now()
const out = searchMixes(paints, hex, { maxK: flags.has('--harder') ? 4 : 3 })
const ms = performance.now() - t0

const nameOf = (id) => {
  const p = paints.find((c) => c.id === id)
  return p ? `${p.product_name} (${p.pigment_ids.join('+')})` : id
}

console.log(`Target ${hex}  ·  inventory ${paints.length} tubes  ·  ${out.evaluated_combos} combos in ${ms.toFixed(0)}ms`)
if (out.skipped_combos) console.log(`  (${out.skipped_combos} combos skipped: NNLS non-convergence)`)
console.log()

if (!out.achievable) {
  console.log(`⚠ Not achievable with what you own (best dE > ${ACHIEVABLE_DE}).`)
  console.log(`  Closest attempts below. To close the gap, add: ${out.missing_pigment_class}`)
  console.log()
}

out.results.forEach((r, i) => {
  const ratio = r.parts.map((p, j) => `${p} part${p > 1 ? 's' : ''} ${nameOf(r.paint_ids[j])}`).join(' : ')
  const verdict = r.delta_e <= MIX_IT_DE ? 'mix it' : r.delta_e <= ACHIEVABLE_DE ? 'usable start, adjust by eye' : 'off'
  console.log(`${i + 1}. ${ratio}`)
  console.log(`   predicted ${r.predicted_hex}  ·  dE ${r.delta_e.toFixed(1)} (${verdict})  ·  ${CONFIDENCE_LABEL[r.confidence_band]}`)
})
