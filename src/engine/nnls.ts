// Non-negative least squares on the simplex (spec §4 pseudocode: nnls_simplex).
// Single-constant KM is linear in K/S, so the achievable set of a combination
// is the convex hull of its members' K/S vectors. We find the continuous
// optimum w >= 0, sum(w) = 1 minimizing ||KS·w - target_KS|| and use it both
// to prune combinations whose hull can't reach the target and to seed the
// integer-parts quantization.
//
// Implementation: Lawson–Hanson active set on the augmented system
// [A; λ·1ᵀ] w ≈ [t; λ], then normalize w to the simplex. Dimensions here are
// tiny (bands+1 rows, k ≤ 4 columns), so normal equations are fine.

export class NNLSError extends Error {}

interface Matrix {
  rows: number
  cols: number
  data: Float64Array // row-major
}

function solveNormalEquations(a: Matrix, b: Float64Array, cols: number[]): Float64Array {
  // Solve least squares over the column subset via AᵀA z = Aᵀb, Gaussian
  // elimination with partial pivoting.
  const n = cols.length
  const ata = new Float64Array(n * n)
  const atb = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0
      for (let r = 0; r < a.rows; r++) {
        sum += a.data[r * a.cols + cols[i]] * a.data[r * a.cols + cols[j]]
      }
      ata[i * n + j] = sum
      ata[j * n + i] = sum
    }
    let sum = 0
    for (let r = 0; r < a.rows; r++) sum += a.data[r * a.cols + cols[i]] * b[r]
    atb[i] = sum
  }
  // Elimination
  const m = ata
  const x = atb
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r * n + col]) > Math.abs(m[pivot * n + col])) pivot = r
    }
    if (Math.abs(m[pivot * n + col]) < 1e-12) throw new NNLSError('singular normal equations')
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const t = m[col * n + c]
        m[col * n + c] = m[pivot * n + c]
        m[pivot * n + c] = t
      }
      const t = x[col]
      x[col] = x[pivot]
      x[pivot] = t
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col] / m[col * n + col]
      for (let c = col; c < n; c++) m[r * n + c] -= f * m[col * n + c]
      x[r] -= f * x[col]
    }
  }
  const z = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let sum = x[r]
    for (let c = r + 1; c < n; c++) sum -= m[r * n + c] * z[c]
    z[r] = sum / m[r * n + r]
  }
  return z
}

export interface NNLSResult {
  /** Weights on the simplex: w >= 0, sum(w) = 1. */
  weights: Float64Array
  /** Residual ||A·w - t|| in K/S space (unaugmented rows only). */
  residual: number
}

/**
 * @param columns K/S vector per combination member (each length = bands)
 * @param target  target K/S vector
 */
export function nnlsSimplex(columns: Float64Array[], target: Float64Array): NNLSResult {
  const k = columns.length
  const bands = target.length
  if (k === 1) {
    const w = new Float64Array([1])
    return { weights: w, residual: residualNorm(columns, w, target) }
  }

  // Augmented system enforcing sum(w) ≈ 1.
  let tNorm = 0
  for (let b = 0; b < bands; b++) tNorm += target[b] * target[b]
  const lambda = 10 * Math.max(1, Math.sqrt(tNorm))
  const rows = bands + 1
  const a: Matrix = { rows, cols: k, data: new Float64Array(rows * k) }
  for (let j = 0; j < k; j++) {
    for (let b = 0; b < bands; b++) a.data[b * k + j] = columns[j][b]
    a.data[bands * k + j] = lambda
  }
  const rhs = new Float64Array(rows)
  rhs.set(target)
  rhs[bands] = lambda

  // Lawson–Hanson active set.
  const w = new Float64Array(k)
  const inP = new Array<boolean>(k).fill(false)
  const tol = 1e-10
  const maxOuter = 3 * k + 6
  let outer = 0
  for (;;) {
    if (++outer > maxOuter) throw new NNLSError('NNLS did not converge')
    // Gradient of 0.5||Aw - b||^2 is Aᵀ(Aw - b); we want most negative, i.e.
    // largest Aᵀ(b - Aw).
    const resid = new Float64Array(rows)
    for (let r = 0; r < rows; r++) {
      let s = rhs[r]
      for (let j = 0; j < k; j++) s -= a.data[r * k + j] * w[j]
      resid[r] = s
    }
    let best = -1
    let bestGrad = tol
    for (let j = 0; j < k; j++) {
      if (inP[j]) continue
      let g = 0
      for (let r = 0; r < rows; r++) g += a.data[r * k + j] * resid[r]
      if (g > bestGrad) {
        bestGrad = g
        best = j
      }
    }
    if (best === -1) break
    inP[best] = true

    let inner = 0
    for (;;) {
      if (++inner > maxOuter) throw new NNLSError('NNLS inner loop did not converge')
      const pCols: number[] = []
      for (let j = 0; j < k; j++) if (inP[j]) pCols.push(j)
      const z = solveNormalEquations(a, rhs, pCols)
      let allPositive = true
      for (const zi of z) if (zi <= tol) allPositive = false
      if (allPositive) {
        w.fill(0)
        pCols.forEach((j, i) => (w[j] = z[i]))
        break
      }
      // Step back to the feasible boundary, drop zeroed variables.
      let alpha = Infinity
      pCols.forEach((j, i) => {
        if (z[i] <= tol) {
          const d = w[j] / (w[j] - z[i])
          if (d < alpha) alpha = d
        }
      })
      pCols.forEach((j, i) => {
        w[j] = w[j] + alpha * (z[i] - w[j])
        if (w[j] <= tol) {
          w[j] = 0
          inP[j] = false
        }
      })
    }
  }

  let sum = 0
  for (let j = 0; j < k; j++) sum += w[j]
  if (sum <= 1e-9) throw new NNLSError('NNLS produced zero weight vector')
  for (let j = 0; j < k; j++) w[j] /= sum

  return { weights: w, residual: residualNorm(columns, w, target) }
}

function residualNorm(columns: Float64Array[], w: Float64Array, target: Float64Array): number {
  let sum = 0
  for (let b = 0; b < target.length; b++) {
    let v = -target[b]
    for (let j = 0; j < columns.length; j++) v += columns[j][b] * w[j]
    sum += v * v
  }
  return Math.sqrt(sum)
}
