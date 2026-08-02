import type { ReactNode } from 'react'
import { CONFIDENCE_HELP, CONFIDENCE_LABEL } from '../engine/confidence.ts'
import type { ConfidenceBand } from '../engine/types.ts'

export function Swatch({ hex, size = 44, label }: { hex: string; size?: number; label?: string }) {
  return (
    <div className="swatch-wrap">
      <span
        className="swatch"
        style={{ background: hex, width: size, height: size }}
        role="img"
        aria-label={label ? `${label} ${hex}` : hex}
      />
      {label && <span className="swatch-label">{label}</span>}
    </div>
  )
}

export function PigmentChips({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="chip chip-warn">unknown pigment</span>
  return (
    <>
      {ids.map((id) => (
        <span key={id} className="chip">
          {id}
        </span>
      ))}
    </>
  )
}

export function ConfidenceTag({ band }: { band: ConfidenceBand }) {
  return (
    <span className={`conf conf-${band}`} title={CONFIDENCE_HELP[band]}>
      {CONFIDENCE_LABEL[band]}
    </span>
  )
}

/** Persistent warning for image-sampled targets (spec F2). */
export function UncalibratedWarning() {
  return (
    <p className="warn-banner" role="alert">
      ⚠ Camera and screen color are uncalibrated — this sampled color is an approximation of the real surface.
    </p>
  )
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="empty-line">{children}</p>
}
