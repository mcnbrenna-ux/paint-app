import { useCallback, useEffect, useState } from 'react'
import { ACHIEVABLE_DE, MIX_IT_DE, searchMixesAsync, type SearchOutput, type SearchRecipe } from '../engine/search.ts'
import type { Recipe, Target } from '../engine/types.ts'
import { uid } from '../db/db.ts'
import { useApp } from '../state/app.tsx'
import { ConfidenceTag, Swatch, UncalibratedWarning } from './components.tsx'

type Phase =
  | { s: 'searching'; progress: number }
  | { s: 'done'; out: SearchOutput }
  | { s: 'error'; message: string }

export function Results({ target }: { target: Target }) {
  const app = useApp()
  const [phase, setPhase] = useState<Phase>({ s: 'searching', progress: 0 })
  const [harder, setHarder] = useState(false)

  const run = useCallback(
    (maxK: 2 | 3 | 4) => {
      setPhase({ s: 'searching', progress: 0 })
      searchMixesAsync(app.usablePaints, target.srgb_hex, { maxK }, (p) =>
        setPhase({ s: 'searching', progress: p.done / p.total }),
      )
        .then((out) => setPhase({ s: 'done', out }))
        .catch((e) => setPhase({ s: 'error', message: e instanceof Error ? e.message : String(e) }))
    },
    [app.usablePaints, target.srgb_hex],
  )

  useEffect(() => run(harder ? 4 : 3), [run, harder])

  const nameOf = (paintId: string) => {
    const p = app.usablePaints.find((x) => x.id === paintId)
    return p ? p.product_name : paintId
  }

  const openRecipe = (r: SearchRecipe) => {
    const recipe: Recipe = {
      id: uid(),
      target_id: target.id,
      target_hex: target.srgb_hex,
      target_origin: target.origin,
      components: r.paint_ids.map((paint_id, i) => ({ paint_id, parts: r.parts[i] })),
      predicted_oklab: r.predicted_oklab,
      predicted_hex: r.predicted_hex,
      delta_e: r.delta_e,
      confidence_band: r.confidence_band,
      saved_at: 0,
    }
    app.nav({ name: 'recipe', recipe, saved: false })
  }

  return (
    <section>
      <header className="screen-head">
        <h2>Recipes</h2>
        <button className="ghost small" onClick={() => app.nav({ name: 'target' })}>
          ← Change target
        </button>
      </header>

      <div className="target-pin">
        <Swatch hex={target.srgb_hex} size={64} label={`target ${target.srgb_hex}`} />
        {target.origin === 'image_sample' && <UncalibratedWarning />}
      </div>

      {phase.s === 'searching' && (
        <div className="progress-block" aria-label="Searching mixes">
          <p>Searching {app.usablePaints.length} tubes…</p>
          <progress value={phase.progress} max={1} />
        </div>
      )}

      {phase.s === 'error' && (
        <div className="error-block" role="alert">
          <p>The mix engine hit an error.</p>
          <p className="row-sub">
            Target {target.srgb_hex} · {app.usablePaints.length} usable tubes · {phase.message}
          </p>
          <button className="primary" onClick={() => run(harder ? 4 : 3)}>
            Retry
          </button>
        </div>
      )}

      {phase.s === 'done' && (
        <>
          {!phase.out.achievable && (
            <div className="nomatch-block">
              <p>
                Nothing in your inventory reaches this color. The closest attempt is shown below — to close the
                gap, add <strong>{phase.out.missing_pigment_class}</strong>.
              </p>
            </div>
          )}
          <ul className="cards">
            {phase.out.results.map((r, i) => (
              <li key={i} className="card" onClick={() => openRecipe(r)}>
                <div className="card-swatches">
                  <Swatch hex={target.srgb_hex} size={52} label="target" />
                  <Swatch hex={r.predicted_hex} size={52} label="predicted" />
                </div>
                <div className="card-main">
                  <p className="ratio">
                    {r.parts.map((p, j) => `${p} ${nameOf(r.paint_ids[j])}`).join(' : ')}
                  </p>
                  <p className="row-sub">
                    ΔE {r.delta_e.toFixed(1)} —{' '}
                    {r.delta_e <= MIX_IT_DE
                      ? 'mix it'
                      : r.delta_e <= ACHIEVABLE_DE
                        ? 'usable start, adjust by eye'
                        : 'not achievable'}{' '}
                    · <ConfidenceTag band={r.confidence_band} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {app.unusableCount > 0 && (
            <p className="hint">{app.unusableCount} of your tubes can’t be used yet (unknown pigment).</p>
          )}
          {!harder && (
            <button className="ghost" onClick={() => setHarder(true)}>
              Search harder (allow 4-paint mixes)
            </button>
          )}
        </>
      )}
    </section>
  )
}
