// Color conversions: sRGB <-> linear RGB, linear RGB -> OKLab, distances.
// The engine's perceptual space is OKLab (spec §4). Delta-E is Euclidean
// distance in OKLab rescaled by 100 to a 0–100 band roughly comparable to
// dE2000 magnitudes. Thresholds (3.0 / 6.0) are defined against this scale.

export type Oklab = readonly [number, number, number]

export function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function linearChannelToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.min(1, Math.max(0, v))
}

export function hexToSrgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Invalid hex color: ${hex}`)
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
}

export function hexToLinearRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToSrgb(hex)
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)]
}

export function linearRgbToHex(rgb: ArrayLike<number>): string {
  const to255 = (c: number) => Math.round(linearChannelToSrgb(c) * 255)
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return `#${h(to255(rgb[0]))}${h(to255(rgb[1]))}${h(to255(rgb[2]))}`
}

// Björn Ottosson's OKLab from linear sRGB.
export function linearRgbToOklab(rgb: ArrayLike<number>): Oklab {
  const [r, g, b] = [rgb[0], rgb[1], rgb[2]]
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}

/** Rescaled OKLab distance: 100 * Euclidean. 0–100 band, dE2000-comparable order of magnitude. */
export function deltaE(a: Oklab, b: Oklab): number {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return 100 * Math.sqrt(dl * dl + da * da + db * db)
}

export function oklabChroma(lab: Oklab): number {
  return Math.hypot(lab[1], lab[2])
}

/** Hue angle in degrees, [0, 360). */
export function oklabHueDeg(lab: Oklab): number {
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI
  return (h + 360) % 360
}
