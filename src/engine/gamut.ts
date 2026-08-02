// Failure mode (a), spec §4: target outside the achievable gamut.
// Name the single pigment class that would close the gap, based on where the
// best attempt falls short of the target in OKLab.

import { type Oklab, oklabChroma, oklabHueDeg } from './color.ts'

// Approximate OKLab hue anchors: red ~25°, yellow ~100°, green ~140°,
// cyan ~195°, blue ~260°, magenta ~330°.
const HUE_CLASSES: { from: number; to: number; label: string }[] = [
  { from: 320, to: 360, label: 'a quinacridone magenta (PV19 / PR122)' },
  { from: 0, to: 15, label: 'a quinacridone magenta (PV19 / PR122)' },
  { from: 15, to: 50, label: 'a high-chroma red (cadmium red PR108 or pyrrole PR254)' },
  { from: 50, to: 80, label: 'a cadmium orange (PO20)' },
  { from: 80, to: 115, label: 'a high-chroma yellow (cadmium PY35 or hansa PY74)' },
  { from: 115, to: 165, label: 'a bright green (phthalo green PG7 or PG36)' },
  { from: 165, to: 225, label: 'a phthalo green/cyan (PG7 / PB16)' },
  { from: 225, to: 250, label: 'a phthalo blue (PB15:3)' },
  { from: 250, to: 290, label: 'an ultramarine blue (PB29)' },
  { from: 290, to: 320, label: 'a dioxazine violet (PV23)' },
]

export function missingPigmentClass(target: Oklab, bestAttempt: Oklab | null): string {
  const chroma = oklabChroma(target)
  const hue = oklabHueDeg(target)

  if (bestAttempt) {
    const dL = target[0] - bestAttempt[0]
    const dChroma = chroma - oklabChroma(bestAttempt)
    // Lightness gap dominates and chroma is basically matched.
    if (Math.abs(dL) > Math.abs(dChroma) + 0.03) {
      if (dL > 0.05) return 'a stronger white (titanium white PW6)'
      if (dL < -0.05) return 'a true black (ivory black PBk9)'
    }
  }

  if (chroma < 0.04) {
    // Near-neutral target we still can't hit: value range is the problem.
    if (target[0] > 0.85) return 'a stronger white (titanium white PW6)'
    if (target[0] < 0.3) return 'a true black (ivory black PBk9)'
  }

  for (const c of HUE_CLASSES) {
    if (hue >= c.from && hue < c.to) return c.label
  }
  return 'a high-chroma pigment in this hue range'
}
