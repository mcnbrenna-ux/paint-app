// Compounded error model (spec §6): every number derived from a photographed
// color reports the compounded figure, never the engine-only figure.
// Combined in quadrature and labeled an estimate.

/** Single-constant KM forward-pass error on measured data, engineering estimate. */
export const KM_MODEL_ERROR = 2.0
/** Extra error from running 3 channels instead of spectra (v1 PRD tradeoff). */
export const SPECTRAL_FALLBACK_ERROR = 3.0

export interface ErrorBand {
  /** Quadrature-combined dE00-comparable figure. */
  value: number
  components: { captureError: number; kmModelError: number; spectralFallbackError: number }
  /** Always 'estimate' — there are no certainties in this pipeline. */
  label: 'estimate'
}

export function compoundedError(captureError: number): ErrorBand {
  const value = Math.sqrt(
    captureError * captureError + KM_MODEL_ERROR * KM_MODEL_ERROR + SPECTRAL_FALLBACK_ERROR * SPECTRAL_FALLBACK_ERROR,
  )
  return {
    value,
    components: {
      captureError,
      kmModelError: KM_MODEL_ERROR,
      spectralFallbackError: SPECTRAL_FALLBACK_ERROR,
    },
    label: 'estimate',
  }
}
