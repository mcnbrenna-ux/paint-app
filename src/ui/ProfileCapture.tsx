// Capture flow for lighting profiles (calibration PRD §4, §6).
// Live camera when the browser allows it — with best-effort AE/AWB locking —
// photo upload as the fallback. Either way, every frame's math runs through
// the §5 pipeline: linearize → median anchor → validate → von Kries → Lab.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildSwatchCapture,
  FrameRejectedError,
  medianRegion,
  sampleAnchor,
  srgb8ToLinear,
  type LinearRgb,
} from '../profiles/correction.ts'
import type { LightingProfile } from '../engine/types.ts'
import { useApp } from '../state/app.tsx'

// §4.2: fixed framing region for the anchor (fractions of the frame).
export const ANCHOR_GUIDE = { x: 0.08, y: 0.6, w: 0.24, h: 0.3 }

type LockStatus = 'locked' | 'partial' | 'unsupported'

interface Props {
  mode: 'anchor' | 'swatches'
  /** Required in swatches mode; in anchor mode used only for labels. */
  profile?: LightingProfile
  onAnchor?: (anchor: { r: number; g: number; b: number }) => void
  onClose: () => void
}

function sampleCanvasRegion(canvas: HTMLCanvasElement, cx: number, cy: number, radius: number): LinearRgb[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const x0 = Math.max(0, Math.min(canvas.width - 2 * radius - 1, cx - radius))
  const y0 = Math.max(0, Math.min(canvas.height - 2 * radius - 1, cy - radius))
  const data = ctx.getImageData(x0, y0, 2 * radius + 1, 2 * radius + 1).data
  const out: LinearRgb[] = []
  for (let i = 0; i < data.length; i += 4) out.push(srgb8ToLinear(data[i], data[i + 1], data[i + 2]))
  return out
}

function sampleGuideRegion(canvas: HTMLCanvasElement): LinearRgb[] {
  // Inner 60% of the guide box, decimated to a few hundred samples.
  const gx = canvas.width * (ANCHOR_GUIDE.x + ANCHOR_GUIDE.w * 0.2)
  const gy = canvas.height * (ANCHOR_GUIDE.y + ANCHOR_GUIDE.h * 0.2)
  const gw = canvas.width * ANCHOR_GUIDE.w * 0.6
  const gh = canvas.height * ANCHOR_GUIDE.h * 0.6
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(Math.round(gx), Math.round(gy), Math.max(2, Math.round(gw)), Math.max(2, Math.round(gh)))
  const step = Math.max(1, Math.floor(Math.sqrt((data.width * data.height) / 500)))
  const out: LinearRgb[] = []
  for (let y = 0; y < data.height; y += step) {
    for (let x = 0; x < data.width; x += step) {
      const i = (y * data.width + x) * 4
      out.push(srgb8ToLinear(data.data[i], data.data[i + 1], data.data[i + 2]))
    }
  }
  return out
}

export function ProfileCapture({ mode, profile, onAnchor, onClose }: Props) {
  const app = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [source, setSource] = useState<'camera' | 'upload' | null>(null)
  const [cameraDenied, setCameraDenied] = useState(false)
  const [lockStatus, setLockStatus] = useState<LockStatus>('unsupported')
  const [frameReady, setFrameReady] = useState(false)
  const [frameAnchor, setFrameAnchor] = useState<LinearRgb | null>(null)
  const [awaitingAnchorTap, setAwaitingAnchorTap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tubeId, setTubeId] = useState<string>('')
  const [savedCount, setSavedCount] = useState(0)
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  const usable = app.tubes.filter((t) => t.paint)

  // §6: lock AE and AWB for the session, best-effort on the web platform.
  const applyLocks = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>
    const wants: MediaTrackConstraintSet[] = []
    if (Array.isArray(caps.exposureMode) && (caps.exposureMode as string[]).includes('manual'))
      wants.push({ exposureMode: 'manual' } as MediaTrackConstraintSet)
    if (Array.isArray(caps.whiteBalanceMode) && (caps.whiteBalanceMode as string[]).includes('manual'))
      wants.push({ whiteBalanceMode: 'manual' } as MediaTrackConstraintSet)
    if (!wants.length) {
      setLockStatus('unsupported')
      return
    }
    try {
      await track.applyConstraints({ advanced: wants })
      setLockStatus(wants.length === 2 ? 'locked' : 'partial')
    } catch {
      setLockStatus('unsupported')
    }
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    try {
      // §6: highest bit depth available — on the web that is the 8-bit canvas
      // path; RAW is not reachable from a PWA, so JPEG-grade frames are the
      // honest ceiling here. Flash stays off (torch constraint below); HDR and
      // night mode are OS-level and are covered by the on-screen instruction.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 } },
      })
      try {
        await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] })
      } catch {
        /* torch constraint unsupported — nothing to turn off */
      }
      streamRef.current = stream
      setSource('camera')
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      await applyLocks()
    } catch {
      setCameraDenied(true)
    }
  }, [applyLocks])

  // §6: re-lock if the session is backgrounded.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && source === 'camera') applyLocks()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [source, applyLocks])

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  const grabFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0)
    setError(null)
    // Camera frames carry the anchor in the fixed guide region (§4.2).
    try {
      const anchor = sampleAnchor(sampleGuideRegion(canvas))
      setFrameAnchor(anchor)
      setAwaitingAnchorTap(false)
      setFrameReady(true)
      if (mode === 'anchor') finishAnchor(anchor)
    } catch (e) {
      if (e instanceof FrameRejectedError) {
        setFrameReady(false)
        setError(e.message)
        return
      }
      throw e
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    setError(null)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current!
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, canvas.width, canvas.height)
      setSource('upload')
      setFrameReady(true)
      setFrameAnchor(null)
      setAwaitingAnchorTap(true) // uploads: the anchor is wherever the dab is — tap it
      URL.revokeObjectURL(url)
    }
    img.onerror = () => setError('Could not read that image. Use a JPEG or PNG.')
    img.src = url
  }

  const finishAnchor = (anchor: LinearRgb) => {
    onAnchor?.({ r: anchor[0], g: anchor[1], b: anchor[2] })
  }

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !frameReady) return
    const rect = canvas.getBoundingClientRect()
    const cx = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width)
    const cy = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height)
    const radius = Math.max(5, Math.round(Math.min(canvas.width, canvas.height) * 0.012))
    const pixels = sampleCanvasRegion(canvas, cx, cy, radius)
    setError(null)
    if (awaitingAnchorTap) {
      try {
        const anchor = sampleAnchor(pixels)
        setFrameAnchor(anchor)
        setAwaitingAnchorTap(false)
        if (mode === 'anchor') finishAnchor(anchor)
      } catch (e) {
        if (e instanceof FrameRejectedError) setError(e.message)
        else throw e
      }
      return
    }
    // Swatch tap.
    if (mode !== 'swatches' || !profile) return
    if (!frameAnchor) {
      setError('Calibrate this shot first — tap the white dab.')
      return
    }
    if (!tubeId) {
      setError('Pick which tube this swatch is before tapping it.')
      return
    }
    const raw = medianRegion(pixels)
    app.addSwatch(profile.id, buildSwatchCapture(tubeId, raw, frameAnchor, profile, Date.now()))
    setSavedCount((n) => n + 1)
    setLastSaved(usable.find((t) => t.paint!.id === tubeId)?.product_name ?? tubeId)
  }

  const anchorLabel = profile?.anchorKind === 'gray_card' ? 'gray card' : 'white dab'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal capture-modal" onClick={(e) => e.stopPropagation()}>
        <header className="screen-head">
          <h3>
            {mode === 'anchor' ? `Shoot the ${anchorLabel}` : `Capture swatches — ${profile?.name ?? ''}`}
          </h3>
          <button className="ghost small" onClick={onClose}>
            Done{savedCount > 0 ? ` (${savedCount} saved)` : ''}
          </button>
        </header>

        <p className="hint">
          Shoot from the position you actually paint in. Turn off HDR, flash, and night mode in your camera
          settings — the app can’t switch those off for you.
          {source === 'camera' && (
            <>
              {' '}
              Exposure/white-balance lock:{' '}
              {lockStatus === 'locked'
                ? 'locked for this session.'
                : lockStatus === 'partial'
                  ? 'partially locked — the ' + anchorLabel + ' carries the rest.'
                  : 'not supported by this browser — the ' + anchorLabel + ' carries the correction.'}
            </>
          )}
        </p>

        {!source && (
          <div className="btn-row">
            {!cameraDenied && (
              <button className="primary" onClick={startCamera}>
                Use camera
              </button>
            )}
            <label className="ghost file-btn">
              Upload a photo
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onFile(e.target.files?.[0])} hidden />
            </label>
          </div>
        )}
        {cameraDenied && !source && <p className="hint">Camera unavailable — upload photos instead; same math applies.</p>}

        {source === 'camera' && (
          <div className="capture-stage">
            <div className="video-wrap">
              <video ref={videoRef} playsInline muted />
              <span
                className="anchor-guide"
                style={{
                  left: `${ANCHOR_GUIDE.x * 100}%`,
                  top: `${ANCHOR_GUIDE.y * 100}%`,
                  width: `${ANCHOR_GUIDE.w * 100}%`,
                  height: `${ANCHOR_GUIDE.h * 100}%`,
                }}
              >
                {anchorLabel} here
              </span>
            </div>
            <div className="btn-row">
              <button className="primary big" onClick={grabFrame}>
                {mode === 'anchor' ? 'Capture anchor' : 'Capture frame'}
              </button>
            </div>
          </div>
        )}

        <div className="canvas-wrap" style={{ display: frameReady && (mode === 'swatches' || source === 'upload') ? 'block' : 'none' }}>
          <canvas ref={canvasRef} onClick={onCanvasClick} />
        </div>
        {source === 'camera' && !frameReady && mode === 'swatches' && (
          <p className="hint">Capture a frame, then tap each swatch in it.</p>
        )}

        {frameReady && awaitingAnchorTap && (
          <p className="warn-banner">Tap the {anchorLabel} in the photo first — it calibrates everything else in the shot.</p>
        )}

        {mode === 'swatches' && frameReady && !awaitingAnchorTap && (
          <div className="swatch-capture-bar">
            <label>
              This swatch is:{' '}
              <select value={tubeId} onChange={(e) => setTubeId(e.target.value)}>
                <option value="">— pick a tube —</option>
                {usable.map((t) => (
                  <option key={t.item.id} value={t.paint!.id}>
                    {t.product_name} ({t.brand})
                  </option>
                ))}
              </select>
            </label>
            <span className="hint">then tap that swatch in the image — repeat for each tube in frame</span>
          </div>
        )}
        {lastSaved && <p className="hint">Saved {lastSaved} ✓ — pick the next tube and tap its swatch.</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
