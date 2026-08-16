// CIE Lab (D50) and CIEDE2000 for the Canvas Coach module (spec §5, §6).
// The v1 engine works in OKLab; Canvas Coach calibration and diagnosis are
// specified in Lab(D50)/dE00 because that's what reference-card patch values
// are published in.

export type Lab = readonly [number, number, number]

// sRGB (D65) linear -> XYZ (D65)
const SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
]

// Bradford chromatic adaptation D65 -> D50
const BRADFORD_D65_TO_D50 = [
  [1.0478112, 0.0228866, -0.050127],
  [0.0295424, 0.9904844, -0.0170491],
  [-0.0092345, 0.0150436, 0.7521316],
]

export const D50_WHITE = [0.96422, 1.0, 0.82521] as const
export const D65_WHITE = [0.95047, 1.0, 1.08883] as const

function mat3mul(m: number[][], v: ArrayLike<number>): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

export function linearRgbToXyzD50(rgb: ArrayLike<number>): [number, number, number] {
  return mat3mul(BRADFORD_D65_TO_D50, mat3mul(SRGB_TO_XYZ, rgb))
}

function fLab(t: number): number {
  const d = 6 / 29
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29
}

function fLabInv(t: number): number {
  const d = 6 / 29
  return t > d ? t * t * t : 3 * d * d * (t - 4 / 29)
}

export function xyzD50ToLab(xyz: ArrayLike<number>): Lab {
  const fx = fLab(xyz[0] / D50_WHITE[0])
  const fy = fLab(xyz[1] / D50_WHITE[1])
  const fz = fLab(xyz[2] / D50_WHITE[2])
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToXyzD50(lab: Lab): [number, number, number] {
  const fy = (lab[0] + 16) / 116
  const fx = fy + lab[1] / 500
  const fz = fy - lab[2] / 200
  return [D50_WHITE[0] * fLabInv(fx), D50_WHITE[1] * fLabInv(fy), D50_WHITE[2] * fLabInv(fz)]
}

export function linearRgbToLabD50(rgb: ArrayLike<number>): Lab {
  return xyzD50ToLab(linearRgbToXyzD50(rgb))
}

/** CIELAB under D65 (no adaptation) — the lighting-profiles PRD's working space (§5.5). */
export function linearRgbToLabD65(rgb: ArrayLike<number>): Lab {
  const xyz = mat3mul(SRGB_TO_XYZ, rgb)
  const fx = fLab(xyz[0] / D65_WHITE[0])
  const fy = fLab(xyz[1] / D65_WHITE[1])
  const fz = fLab(xyz[2] / D65_WHITE[2])
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Lab(D50) -> linear sRGB (via inverse Bradford), for reference-value fitting. */
export function labD50ToLinearRgb(lab: Lab): [number, number, number] {
  const xyzD50 = labToXyzD50(lab)
  // Inverse Bradford D50 -> D65, then XYZ -> linear sRGB.
  const D50_TO_D65 = [
    [0.9555766, -0.0230393, 0.0631636],
    [-0.0282895, 1.0099416, 0.0210077],
    [0.0122982, -0.020483, 1.3299098],
  ]
  const XYZ_TO_SRGB = [
    [3.2404542, -1.5371385, -0.4985314],
    [-0.969266, 1.8760108, 0.041556],
    [0.0556434, -0.2040259, 1.0572252],
  ]
  return mat3mul(XYZ_TO_SRGB, mat3mul(D50_TO_D65, xyzD50))
}

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** CIEDE2000 color difference (Sharma et al. 2005 formulation). */
export function deltaE00(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp: number
  if (C1p * C2p === 0) dhp = 0
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360
  else dhp = h2p - h1p + 360
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2)

  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp: number
  if (C1p * C2p === 0) hbp = h1p + h2p
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2
  else hbp = (h1p + h2p - 360) / 2

  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63))
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const Cbp7 = Math.pow(Cbp, 7)
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc

  const l = dLp / Sl
  const c = dCp / Sc
  const h = dHp / Sh
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h)
}
