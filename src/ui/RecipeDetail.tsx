import { useState } from 'react'
import type { CorrectionAxis, CorrectionMagnitude, Recipe } from '../engine/types.ts'
import { useApp } from '../state/app.tsx'
import { ConfidenceTag, PigmentChips, Swatch, UncalibratedWarning } from './components.tsx'

const AXES: { axis: CorrectionAxis; label: string }[] = [
  { axis: 'lighter', label: 'Lighter' },
  { axis: 'darker', label: 'Darker' },
  { axis: 'warmer', label: 'Warmer' },
  { axis: 'cooler', label: 'Cooler' },
  { axis: 'duller', label: 'Duller' },
  { axis: 'more_saturated', label: 'More saturated' },
]

export function RecipeDetail({ recipe, saved }: { recipe: Recipe; saved: boolean }) {
  const app = useApp()
  const [isSaved, setIsSaved] = useState(saved)
  const [magnitude, setMagnitude] = useState<CorrectionMagnitude>('slight')
  const [lastLogged, setLastLogged] = useState<CorrectionAxis | null>(null)

  const paintInfo = (paintId: string) => {
    const tube = app.tubes.find((t) => t.paint?.id === paintId)
    if (tube) return { name: tube.product_name, brand: tube.brand, pigments: tube.pigment_ids }
    const cat = app.catalog?.paints.find((p) => p.id === paintId)
    if (cat) return { name: cat.product_name, brand: cat.brand, pigments: cat.pigment_ids }
    return { name: paintId, brand: '', pigments: [] }
  }

  const save = async () => {
    const r: Recipe = { ...recipe, saved_at: Date.now() }
    await app.saveRecipe(r)
    recipe.saved_at = r.saved_at
    setIsSaved(true)
  }

  const log = (axis: CorrectionAxis) => {
    app.addCorrection(recipe, axis, magnitude)
    setLastLogged(axis)
  }

  return (
    <section>
      <header className="screen-head">
        <h2>Recipe</h2>
        <button className="ghost small" onClick={() => app.nav(isSaved ? { name: 'saved' } : { name: 'target' })}>
          ← Back
        </button>
      </header>

      <div className="card-swatches big-swatches">
        <Swatch hex={recipe.target_hex} size={84} label={`target ${recipe.target_hex}`} />
        <Swatch hex={recipe.predicted_hex} size={84} label={`predicted ${recipe.predicted_hex}`} />
      </div>
      <p className="row-sub center">
        ΔE {recipe.delta_e.toFixed(1)} · <ConfidenceTag band={recipe.confidence_band} />
      </p>
      {recipe.target_origin === 'image_sample' && <UncalibratedWarning />}

      <h3 className="group-head">Mixing order — largest volume first</h3>
      <ol className="rows">
        {recipe.components.map((c, i) => {
          const info = paintInfo(c.paint_id)
          return (
            <li key={i} className="row">
              <span className="parts-badge">
                {c.parts} part{c.parts > 1 ? 's' : ''}
              </span>
              <div className="row-main">
                <span className="row-title">{info.name}</span>
                <span className="row-sub">
                  {info.brand} · <PigmentChips ids={info.pigments} />
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      {!isSaved ? (
        <div className="btn-row">
          <button className="primary big" onClick={save}>
            Save recipe
          </button>
        </div>
      ) : (
        <>
          <h3 className="group-head">After mixing: how did the real result differ?</h3>
          <div className="mag-toggle" role="radiogroup" aria-label="Correction magnitude">
            {(['slight', 'obvious'] as const).map((m) => (
              <button
                key={m}
                className={`ghost small ${magnitude === m ? 'active' : ''}`}
                onClick={() => setMagnitude(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="correction-grid">
            {AXES.map(({ axis, label }) => (
              <button key={axis} className="ghost" onClick={() => log(axis)}>
                {label}
              </button>
            ))}
          </div>
          {lastLogged && (
            <p className="hint">
              Logged: actual result was {magnitude} {lastLogged.replace('_', ' ')} than predicted.
            </p>
          )}
        </>
      )}
    </section>
  )
}
