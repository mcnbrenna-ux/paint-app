import { useEffect, useMemo, useRef, useState } from 'react'
import { hexToLinearRgb, linearRgbToHex, linearRgbToOklab } from '../engine/color.ts'
import { searchMixesAsync, verdictLabel, type SearchRecipe } from '../engine/search.ts'
import type { ReferencePin, Target, TargetOrigin } from '../engine/types.ts'
import { linearRgbToLabD65 } from '../coach/lab.ts'
import {
  applyGains,
  defaultProfile,
  FrameRejectedError,
  matchInProfile,
  medianRegion,
  sampleAnchor,
  srgb8ToLinear,
  vonKriesGains,
  type LinearRgb,
} from '../profiles/correction.ts'
import { uid } from '../db/db.ts'
import { useApp } from '../state/app.tsx'
import { ConfidenceTag, EmptyLine, Swatch, UncalibratedWarning } from './components.tsx'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const NEUTRAL = '#808080'

type PinMix = { key: string; loading: boolean; best: SearchRecipe | null; achievable: boolean }

export function Studio() {
  const app = useApp()
  const [mode, setMode] = useState<'photo' | 'picker'>('photo')

  // §7: entering the comparison flow defaults to the most-used profile —
  // pre-selected automatically (without inflating its use count), switchable
  // in one tap in the workspace below.
  useEffect(() => {
    if (!app.activeProfile) {
      const verified = app.profiles.filter((p) => p.lastVerifiedAt > 0)
      const def = defaultProfile(verified)
      if (def) app.setActiveProfile(def.id, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.profiles.length])

  return (
    <section>
      <header className="screen-head">
        <h2>Mix</h2>
        <div className="mode-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'photo'}
            className={`ghost small ${mode === 'photo' ? 'active' : ''}`}
            onClick={() => setMode('photo')}
          >
            Reference photo
          </button>
          <button
            role="tab"
            aria-selected={mode === 'picker'}
            className={`ghost small ${mode === 'picker' ? 'active' : ''}`}
            onClick={() => setMode('picker')}
          >
            Color picker
          </button>
        </div>
      </header>
      {app.usablePaints.length < 2 && (
        <p className="warn-banner">
          The mix search needs at least 2 usable tubes
          {app.unusableCount > 0 ? ` — ${app.unusableCount} of yours can’t be used yet (unknown pigment)` : ''}. Add
          tubes on the Tubes tab first.
        </p>
      )}
      {mode === 'photo' ? <PhotoWorkspace /> : <PickerPane />}
    </section>
  )
}

function PhotoWorkspace() {
  const app = useApp()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [ready, setReady] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [mixes, setMixes] = useState<Record<string, PinMix>>({})
  const [anchorError, setAnchorError] = useState<string | null>(null)

  const pins = app.reference?.pins ?? []
  const profile = app.activeProfile
  const verifiedProfiles = app.profiles.filter((p) => p.lastVerifiedAt > 0)
  // The photo's anchor only counts for the profile it was tapped under.
  const photoAnchor =
    profile && app.reference?.anchor && app.reference.anchor.profile_id === profile.id ? app.reference.anchor : null
  const needsAnchor = !!profile && !!app.reference && !photoAnchor
  const invKey = useMemo(() => app.usablePaints.map((p) => p.id).sort().join('|'), [app.usablePaints])

  // Draw the persisted reference photo whenever it changes.
  useEffect(() => {
    setReady(false)
    setImageError(null)
    if (!app.reference) return
    setDecoding(true)
    const url = URL.createObjectURL(app.reference.image)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, canvas.width, canvas.height)
        setReady(true)
      }
      setDecoding(false)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      setImageError('Could not decode the stored photo. Choose a new one (JPEG, PNG, WebP, GIF).')
      setDecoding(false)
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [app.reference?.image]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the best mix for any pin that doesn't have one for the current
  // inventory. Sequential so a burst of pins doesn't stack up searches.
  const computing = useRef(false)
  useEffect(() => {
    if (computing.current || app.usablePaints.length < 2) return
    const pending = pins.find((p) => mixes[p.id]?.key !== `${p.hex}:${invKey}`)
    if (!pending) return
    computing.current = true
    const key = `${pending.hex}:${invKey}`
    setMixes((m) => ({ ...m, [pending.id]: { key, loading: true, best: null, achievable: false } }))
    searchMixesAsync(app.usablePaints, pending.hex)
      .then((out) => {
        setMixes((m) => ({
          ...m,
          [pending.id]: { key, loading: false, best: out.results[0] ?? null, achievable: out.achievable },
        }))
      })
      .catch(() => {
        setMixes((m) => ({ ...m, [pending.id]: { key, loading: false, best: null, achievable: false } }))
      })
      .finally(() => {
        computing.current = false
      })
  }, [pins, mixes, invKey, app.usablePaints])

  const onFile = (file: File | undefined) => {
    setImageError(null)
    setAnchorError(null)
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setImageError('Unsupported file type. Accepted formats: JPEG, PNG, WebP, GIF.')
      return
    }
    // Replacing the photo starts a fresh set of pins (and a fresh anchor).
    app.setReferenceImage(file)
    setMixes({})
    setConfirmClear(false)
  }

  /** §5.1–5.2: linear pixels in a small radius around the tap. */
  const sampleTapRegion = (e: React.MouseEvent<HTMLCanvasElement>): { pixels: LinearRgb[]; relX: number; relY: number } | null => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return null
    const rect = canvas.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    const cx = Math.round(relX * canvas.width)
    const cy = Math.round(relY * canvas.height)
    const radius = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.008))
    const x0 = Math.max(0, Math.min(canvas.width - 2 * radius - 1, cx - radius))
    const y0 = Math.max(0, Math.min(canvas.height - 2 * radius - 1, cy - radius))
    const data = canvas
      .getContext('2d', { willReadFrequently: true })!
      .getImageData(x0, y0, 2 * radius + 1, 2 * radius + 1).data
    const pixels: LinearRgb[] = []
    for (let i = 0; i < data.length; i += 4) pixels.push(srgb8ToLinear(data[i], data[i + 1], data[i + 2]))
    return { pixels, relX, relY }
  }

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sample = sampleTapRegion(e)
    if (!sample) return
    setAnchorError(null)

    // With a profile active, the first tap must be the white anchor (§2.3).
    if (needsAnchor) {
      try {
        const anchor = sampleAnchor(sample.pixels)
        app.setReferenceAnchor({
          x: sample.relX,
          y: sample.relY,
          r: anchor[0],
          g: anchor[1],
          b: anchor[2],
          profile_id: profile!.id,
        })
      } catch (err) {
        if (err instanceof FrameRejectedError) setAnchorError(err.message)
        else throw err
      }
      return
    }

    const raw = medianRegion(sample.pixels)
    let hex: string
    let calibrated = false
    if (profile && photoAnchor) {
      // §5.4: von Kries against this photo's anchor. We correct every sampled
      // pixel rather than repainting the whole displayed frame — only sampled
      // colors flow downstream, and the visible photo stays what the camera saw.
      const gains = vonKriesGains(profile.anchorReference, [photoAnchor.r, photoAnchor.g, photoAnchor.b])
      hex = linearRgbToHex(applyGains(raw, gains))
      calibrated = true
    } else {
      hex = linearRgbToHex(raw)
    }
    app.addReferencePin({ x: sample.relX, y: sample.relY, hex, calibrated })
  }

  const openAllRecipes = (pin: ReferencePin) => {
    const target: Target = {
      id: uid(),
      srgb_hex: pin.hex,
      oklab: [...linearRgbToOklab(hexToLinearRgb(pin.hex))] as [number, number, number],
      origin: 'image_sample',
      image_ref: 'reference',
    }
    if (profile && photoAnchor) {
      target.profile_name = profile.name
      target.profile_kind = profile.kind
    }
    app.nav({ name: 'results', target })
  }

  const tubeName = (paintId: string) =>
    app.tubes.find((t) => t.paint?.id === paintId)?.product_name ?? paintId

  return (
    <div className="studio">
      <div className="studio-main">
        {/* §7: the active profile is one tap and never ambiguous. */}
        <div className="profile-bar">
          <span className="palette-label">Light</span>
          <select
            value={profile?.id ?? ''}
            onChange={(e) => app.setActiveProfile(e.target.value || null)}
            aria-label="Active lighting profile"
          >
            <option value="">None — uncalibrated</option>
            {verifiedProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.kind === 'daylight' ? ' (variable)' : ''}
              </option>
            ))}
          </select>
          {verifiedProfiles.length === 0 && (
            <span className="hint">Set one up on the Light tab for repeatable colors.</span>
          )}
        </div>

        {!app.reference ? (
          <div
            className="dropzone tall"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onFile(e.dataTransfer.files[0])
            }}
          >
            <p>Drop your reference photo here, or</p>
            <label className="ghost file-btn">
              Choose an image
              <input type="file" accept={ACCEPTED.join(',')} onChange={(e) => onFile(e.target.files?.[0])} hidden />
            </label>
            <p className="hint">
              The photo stays here — across screens and app restarts — until you replace it.
              {profile ? ' Keep your white dab visible in the shot.' : ''}
            </p>
          </div>
        ) : (
          <>
            {needsAnchor && (
              <p className="warn-banner" role="alert">
                Tap your {profile?.anchorKind === 'gray_card' ? 'gray card' : 'white dab'} in the photo first — it
                calibrates every color you sample from this shot.
              </p>
            )}
            {anchorError && (
              <p className="inline-error" role="alert">
                {anchorError}
              </p>
            )}
            <div className="canvas-wrap">
              {decoding && <div className="spinner" aria-label="Decoding image" />}
              <canvas ref={canvasRef} onClick={onCanvasClick} />
              {photoAnchor && (
                <span className="anchor-marker" style={{ left: `${photoAnchor.x * 100}%`, top: `${photoAnchor.y * 100}%` }}>
                  A
                </span>
              )}
              {pins.map((pin, i) => (
                <span
                  key={pin.id}
                  className="pin-marker"
                  style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, background: pin.hex }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            <div className="btn-row left">
              <label className="ghost small file-btn">
                Replace photo
                <input type="file" accept={ACCEPTED.join(',')} onChange={(e) => onFile(e.target.files?.[0])} hidden />
              </label>
              {!confirmClear ? (
                <button className="ghost small" onClick={() => setConfirmClear(true)}>
                  Clear photo
                </button>
              ) : (
                <>
                  <button
                    className="ghost small danger"
                    onClick={() => {
                      app.clearReference()
                      setMixes({})
                      setConfirmClear(false)
                    }}
                  >
                    Really clear photo{pins.length ? ` + ${pins.length} spot${pins.length > 1 ? 's' : ''}` : ''}
                  </button>
                  <button className="ghost small" onClick={() => setConfirmClear(false)}>
                    Keep it
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {imageError && <p className="inline-error">{imageError}</p>}
      </div>

      <aside className="studio-side">
        <h3 className="group-head">
          Sampled spots
          {/* AC5: the active profile is visible wherever matches are shown. */}
          {profile && photoAnchor ? (
            <span className={`profile-chip ${profile.kind === 'daylight' ? 'chip-warn' : ''}`}>{profile.name}</span>
          ) : null}
        </h3>
        {profile && photoAnchor && profile.kind === 'daylight' && (
          <p className="hint">Daylight profile — variable light, treat matches as lower confidence.</p>
        )}
        {pins.length > 0 && !(profile && photoAnchor) && <UncalibratedWarning />}
        {pins.length === 0 ? (
          <EmptyLine>
            {app.reference
              ? needsAnchor
                ? 'Tap the white dab first, then tap anywhere to sample spots.'
                : 'Tap anywhere on the photo to sample a spot — each spot gets its own mix here.'
              : 'Add a photo, then tap it to collect spots. Every spot gets its own mix.'}
          </EmptyLine>
        ) : (
          <ul className="cards">
            {pins.map((pin, i) => {
              const mix = mixes[pin.id]
              const matches =
                profile && photoAnchor && profile.swatches.length
                  ? matchInProfile(profile, linearRgbToLabD65(hexToLinearRgb(pin.hex)), 1)
                  : []
              return (
                <li key={pin.id} className="card pin-card">
                  <span className="pin-num">{i + 1}</span>
                  <Swatch hex={pin.hex} size={44} label={pin.hex} />
                  <div className="card-main">
                    {profile && photoAnchor && !pin.calibrated && (
                      <p className="row-sub"><em className="tag-unusable">sampled before calibration — re-tap it</em></p>
                    )}
                    {matches.length > 0 && (
                      <p className="row-sub">
                        Closest tube here: <strong>{tubeName(matches[0].pigmentId)}</strong> · ΔE2000{' '}
                        {matches[0].deltaE2000.toFixed(1)}
                      </p>
                    )}
                    {!mix || mix.loading ? (
                      <p className="row-sub">Searching…</p>
                    ) : mix.best ? (
                      <>
                        <p className="ratio">
                          {mix.best.parts.map((p, j) => `${p} ${tubeName(mix.best!.paint_ids[j])}`).join(' : ')}
                        </p>
                        <p className="row-sub">
                          ΔE {mix.best.delta_e.toFixed(1)} — {verdictLabel(mix.best.delta_e)} ·{' '}
                          <ConfidenceTag band={mix.best.confidence_band} />
                        </p>
                      </>
                    ) : (
                      <p className="row-sub">No mix found — add more tubes.</p>
                    )}
                    <div className="pin-actions">
                      <button className="ghost small" onClick={() => openAllRecipes(pin)}>
                        All recipes
                      </button>
                      <button
                        className="ghost small"
                        onClick={() => app.removeReferencePin(pin.id)}
                        aria-label={`Remove spot ${i + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}

function PickerPane() {
  const app = useApp()
  const [hex, setHex] = useState(NEUTRAL)
  const oklab = safeOklab(hex)

  const go = () => {
    const target: Target = {
      id: uid(),
      srgb_hex: normalizeHex(hex)!,
      oklab: oklab!,
      origin: 'picker' as TargetOrigin,
      image_ref: null,
    }
    app.nav({ name: 'results', target })
  }

  return (
    <div className="target-pane picker-pane">
      <div className="picker-row">
        <input
          type="color"
          value={normalizeHex(hex) ?? NEUTRAL}
          onChange={(e) => setHex(e.target.value)}
          aria-label="Color picker"
        />
        <input
          className="hex-input"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          spellCheck={false}
          aria-label="Hex value"
        />
        <Swatch hex={normalizeHex(hex) ?? NEUTRAL} size={64} label="target" />
      </div>
      {oklab ? (
        <p className="oklab-readout">
          OKLab&ensp;L {oklab[0].toFixed(3)} · a {oklab[1].toFixed(3)} · b {oklab[2].toFixed(3)}
        </p>
      ) : (
        <p className="inline-error">Enter a 6-digit hex color, e.g. #6a8f5a</p>
      )}
      <div className="btn-row left">
        <button className="primary big" onClick={go} disabled={!oklab || app.usablePaints.length < 2}>
          Find mixes
        </button>
      </div>
    </div>
  )
}

function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

function safeOklab(hex: string): [number, number, number] | null {
  const n = normalizeHex(hex)
  if (!n) return null
  const lab = linearRgbToOklab(hexToLinearRgb(n))
  return [lab[0], lab[1], lab[2]]
}
