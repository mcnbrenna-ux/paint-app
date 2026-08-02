import { useEffect, useMemo, useRef, useState } from 'react'
import { hexToLinearRgb, linearRgbToOklab } from '../engine/color.ts'
import { ACHIEVABLE_DE, MIX_IT_DE, searchMixesAsync, type SearchRecipe } from '../engine/search.ts'
import type { ReferencePin, Target, TargetOrigin } from '../engine/types.ts'
import { uid } from '../db/db.ts'
import { useApp } from '../state/app.tsx'
import { ConfidenceTag, EmptyLine, Swatch, UncalibratedWarning } from './components.tsx'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const NEUTRAL = '#808080'

type PinMix = { key: string; loading: boolean; best: SearchRecipe | null; achievable: boolean }

export function Studio() {
  const app = useApp()
  const [mode, setMode] = useState<'photo' | 'picker'>('photo')

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

  const pins = app.reference?.pins ?? []
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
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setImageError('Unsupported file type. Accepted formats: JPEG, PNG, WebP, GIF.')
      return
    }
    // Replacing the photo starts a fresh set of pins.
    app.setReferenceImage(file)
    setMixes({})
    setConfirmClear(false)
  }

  const samplePin = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    const rect = canvas.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    const px = Math.round(relX * canvas.width)
    const py = Math.round(relY * canvas.height)
    // 5x5 pixel average around the tap (spec F2).
    const x0 = Math.max(0, Math.min(canvas.width - 5, px - 2))
    const y0 = Math.max(0, Math.min(canvas.height - 5, py - 2))
    const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, 5, 5).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
    }
    const n = data.length / 4
    const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
    app.addReferencePin({ x: relX, y: relY, hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` })
  }

  const openAllRecipes = (pin: ReferencePin) => {
    const target: Target = {
      id: uid(),
      srgb_hex: pin.hex,
      oklab: [...linearRgbToOklab(hexToLinearRgb(pin.hex))] as [number, number, number],
      origin: 'image_sample',
      image_ref: 'reference',
    }
    app.nav({ name: 'results', target })
  }

  return (
    <div className="studio">
      <div className="studio-main">
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
            <p className="hint">The photo stays here — across screens and app restarts — until you replace it.</p>
          </div>
        ) : (
          <>
            <div className="canvas-wrap">
              {decoding && <div className="spinner" aria-label="Decoding image" />}
              <canvas ref={canvasRef} onClick={samplePin} />
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
        <h3 className="group-head">Sampled spots</h3>
        {pins.length > 0 && <UncalibratedWarning />}
        {pins.length === 0 ? (
          <EmptyLine>
            {app.reference
              ? 'Tap anywhere on the photo to sample a spot — each spot gets its own mix here.'
              : 'Add a photo, then tap it to collect spots. Every spot gets its own mix.'}
          </EmptyLine>
        ) : (
          <ul className="cards">
            {pins.map((pin, i) => {
              const mix = mixes[pin.id]
              return (
                <li key={pin.id} className="card pin-card">
                  <span className="pin-num">{i + 1}</span>
                  <Swatch hex={pin.hex} size={44} label={pin.hex} />
                  <div className="card-main">
                    {!mix || mix.loading ? (
                      <p className="row-sub">Searching…</p>
                    ) : mix.best ? (
                      <>
                        <p className="ratio">
                          {mix.best.parts.map((p, j) => `${p} ${paintName(app, mix.best!.paint_ids[j])}`).join(' : ')}
                        </p>
                        <p className="row-sub">
                          ΔE {mix.best.delta_e.toFixed(1)} —{' '}
                          {mix.best.delta_e <= MIX_IT_DE
                            ? 'mix it'
                            : mix.best.delta_e <= ACHIEVABLE_DE
                              ? 'usable start'
                              : 'not achievable'}{' '}
                          · <ConfidenceTag band={mix.best.confidence_band} />
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

function paintName(app: ReturnType<typeof useApp>, paintId: string): string {
  const p = app.usablePaints.find((x) => x.id === paintId)
  return p ? p.product_name : paintId
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
