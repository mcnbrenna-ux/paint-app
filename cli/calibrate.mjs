#!/usr/bin/env node
// Canvas Coach Phase A harness (spec §12): CLI-first capture calibration.
// No Canvas Coach UI exists or may exist until this pipeline passes the
// physical gate: median captureError <= 4.0 dE00 across a 20-photo test set
// under 3 lighting conditions.
//
// Usage:
//   node cli/calibrate.mjs --selftest
//       Synthetic validation: distorts reference patches through fake cameras
//       and reports whether the pipeline recovers them.
//
//   node cli/calibrate.mjs shot.json [more-shots.json ...]
//       Each JSON describes one photographed shot:
//       {
//         "name": "easel-daylight-01",
//         "target": "colorchecker" | "graycard",
//         // colorchecker: 24 patch colors in standard order; graycard: 1
//         "patches_srgb": ["#8b5a44", ...],
//         // optional paint regions sampled from the same frame
//         "samples": [{ "id": "shadow-mass", "pixels_srgb": ["#43506b", ...] }]
//       }
//       Prints captureError per shot, the median across shots, corrected
//       Lab(D50) per sample with the compounded error band, and the gate
//       verdict for the set.

import { readFileSync } from 'node:fs'
import {
  calibrateColorChecker,
  calibrateGrayCard,
  CaptureRejectedError,
  COLORCHECKER_LAB,
} from '../src/coach/calibrate.ts'
import { compoundedError } from '../src/coach/errors.ts'
import { extractRegion, hasBlownHighlights } from '../src/coach/extract.ts'
import { labD50ToLinearRgb } from '../src/coach/lab.ts'
import { hexToLinearRgb } from '../src/engine/color.ts'

const PHASE_A_GATE = 4.0

const args = process.argv.slice(2)

if (args.includes('--selftest')) {
  selftest()
  process.exit(0)
}
if (args.length === 0) {
  console.error('Usage: node cli/calibrate.mjs --selftest | shot.json [...]')
  process.exit(2)
}

const errors = []
for (const file of args) {
  const shot = JSON.parse(readFileSync(file, 'utf8'))
  const patches = shot.patches_srgb.map((h) => [...hexToLinearRgb(h)])
  let cal
  try {
    cal = shot.target === 'graycard' ? calibrateGrayCard(patches[0]) : calibrateColorChecker(patches)
  } catch (e) {
    if (e instanceof CaptureRejectedError) {
      console.log(`✗ ${shot.name ?? file}: REJECTED — ${e.message}`)
      errors.push(Infinity)
      continue
    }
    throw e
  }
  errors.push(cal.captureError)
  console.log(`✓ ${shot.name ?? file}: captureError ${cal.captureError.toFixed(2)} dE00 (${cal.kind})`)
  for (const s of shot.samples ?? []) {
    const pixels = s.pixels_srgb.map((h) => [...hexToLinearRgb(h)])
    if (hasBlownHighlights(pixels)) {
      console.log(`    ${s.id}: blown highlights in region — re-shoot at a raked angle`)
      continue
    }
    const ex = extractRegion(pixels, cal)
    const band = compoundedError(ex.captureError)
    console.log(
      `    ${s.id}: Lab(D50) ${ex.lab.map((v) => v.toFixed(1)).join(', ')}  ±${band.value.toFixed(1)} (estimate; ` +
        `capture ${band.components.captureError.toFixed(1)} ⊕ model ${band.components.kmModelError} ⊕ 3-band ${band.components.spectralFallbackError})`,
    )
  }
}

const finite = errors.filter((e) => Number.isFinite(e)).sort((a, b) => a - b)
if (finite.length) {
  const median = finite[finite.length >> 1]
  console.log(`\nShots accepted: ${finite.length}/${errors.length} · median captureError ${median.toFixed(2)} dE00`)
  if (errors.length >= 20) {
    console.log(
      median <= PHASE_A_GATE
        ? `PHASE A GATE: PASS (median ≤ ${PHASE_A_GATE})`
        : `PHASE A GATE: FAIL (median > ${PHASE_A_GATE}) — Canvas Coach UI stays unbuilt.`,
    )
  } else {
    console.log(`Phase A gate needs ≥ 20 shots under 3 lighting conditions (have ${errors.length}).`)
  }
}

function selftest() {
  const referenceRgb = COLORCHECKER_LAB.map((lab) => [...labD50ToLinearRgb(lab)].map((v) => Math.max(0, v)))
  const cameras = [
    { name: 'warm tungsten cast', gains: [1.35, 1.0, 0.65] },
    { name: 'cool overcast cast', gains: [0.8, 0.95, 1.3] },
    { name: 'underexposed 1 stop', gains: [0.5, 0.5, 0.5] },
  ]
  console.log('Synthetic self-test (linear distortions the pipeline must fully correct):')
  for (const cam of cameras) {
    const observed = referenceRgb.map((p) => p.map((v, i) => v * cam.gains[i]))
    const cal = calibrateColorChecker(observed)
    const ok = cal.captureError < 1.0
    console.log(`  ${ok ? '✓' : '✗'} ${cam.name}: residual ${cal.captureError.toFixed(3)} dE00`)
  }
  const crushed = referenceRgb.map((p) => [Math.pow(p[0], 2.6), Math.pow(p[1], 0.4), p[2] * 0.15 + 0.35])
  try {
    calibrateColorChecker(crushed)
    console.log('  ✗ nonlinear crush: was NOT rejected (should have been)')
  } catch (e) {
    console.log(`  ✓ nonlinear crush: rejected as designed (${e.captureError.toFixed(1)} dE00)`)
  }
  console.log('\nThe real Phase A gate is physical: 20 photos, 3 lighting conditions, median ≤ 4.0 dE00.')
}
