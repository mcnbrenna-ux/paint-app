import { useRef, useState } from 'react'
import { hexToLinearRgb, linearRgbToOklab } from '../engine/color.ts'
import type { Target, TargetOrigin } from '../engine/types.ts'
import { uid } from '../db/db.ts'
import { useApp } from '../state/app.tsx'
import { Swatch, UncalibratedWarning } from './components.tsx'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const NEUTRAL = '#808080'

export function TargetEntry() {
  const app = useApp()
  const [hex, setHex] = useState(NEUTRAL)
  const [origin, setOrigin] = useState<TargetOrigin>('picker')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgWrapRef = useRef<HTMLDivElement>(null)

  const oklab = safeOklab(hex)

  const setPicked = (h: string) => {
    setHex(h)
    setOrigin('picker')
  }

  const onFile = (file: File | undefined) => {
    setImageError(null)
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setImageError('Unsupported file type. Accepted formats: JPEG, PNG, WebP, GIF.')
      return
    }
    setDecoding(true)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current!
      // Cap decode size; sampling precision beyond ~1600px doesn't matter.
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, canvas.width, canvas.height)
      setImageUrl(url)
      setMarker(null)
      setDecoding(false)
    }
    img.onerror = () => {
      setImageError('Could not decode that image. Accepted formats: JPEG, PNG, WebP, GIF.')
      setDecoding(false)
    }
    img.src = url
  }

  const sample = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const px = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width)
    const py = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height)
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
    setHex(`#${toHex(r)}${toHex(g)}${toHex(b)}`)
    setOrigin('image_sample')
    setMarker({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height })
  }

  const go = () => {
    const target: Target = {
      id: uid(),
      srgb_hex: hex,
      oklab: oklab!,
      origin,
      image_ref: origin === 'image_sample' ? imageUrl : null,
    }
    app.nav({ name: 'results', target })
  }

  const tooFewTubes = app.usablePaints.length < 2

  return (
    <section>
      <header className="screen-head">
        <h2>Target color</h2>
      </header>

      <div className="target-grid">
        <div className="target-pane">
          <h3 className="group-head">Pick or type</h3>
          <div className="picker-row">
            <input
              type="color"
              value={normalizeHex(hex) ?? NEUTRAL}
              onChange={(e) => setPicked(e.target.value)}
              aria-label="Color picker"
            />
            <input
              className="hex-input"
              value={hex}
              onChange={(e) => {
                setHex(e.target.value)
                setOrigin('picker')
              }}
              spellCheck={false}
              aria-label="Hex value"
            />
          </div>
          {oklab ? (
            <p className="oklab-readout">
              OKLab&ensp;L {oklab[0].toFixed(3)} · a {oklab[1].toFixed(3)} · b {oklab[2].toFixed(3)}
            </p>
          ) : (
            <p className="inline-error">Enter a 6-digit hex color, e.g. #6a8f5a</p>
          )}
          <Swatch hex={normalizeHex(hex) ?? NEUTRAL} size={96} label="target" />
        </div>

        <div className="target-pane">
          <h3 className="group-head">Or sample a photo</h3>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onFile(e.dataTransfer.files[0])
            }}
          >
            {decoding && <div className="spinner" aria-label="Decoding image" />}
            <div ref={imgWrapRef} className="canvas-wrap" style={{ display: imageUrl ? 'block' : 'none' }}>
              <canvas ref={canvasRef} onClick={sample} />
              {marker && (
                <span
                  className="sample-marker"
                  style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                />
              )}
            </div>
            {!imageUrl && !decoding && <p>Drop a reference photo here, or</p>}
            <label className="ghost file-btn">
              {imageUrl ? 'Choose a different image' : 'Choose an image'}
              <input type="file" accept={ACCEPTED.join(',')} onChange={(e) => onFile(e.target.files?.[0])} hidden />
            </label>
            {imageUrl && <p className="hint">Tap the photo to sample a 5×5 pixel average.</p>}
          </div>
          {imageError && <p className="inline-error">{imageError}</p>}
          {origin === 'image_sample' && <UncalibratedWarning />}
        </div>
      </div>

      <div className="btn-row">
        <button className="primary big" onClick={go} disabled={!oklab || tooFewTubes}>
          Find mixes
        </button>
      </div>
      {tooFewTubes && (
        <p className="hint">
          The mix search needs at least 2 usable tubes in your inventory
          {app.unusableCount > 0 ? ` — ${app.unusableCount} of yours can’t be used yet (unknown pigment)` : ''}.
        </p>
      )}
    </section>
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
