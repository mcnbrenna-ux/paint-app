import { useApp } from '../state/app.tsx'
import { EmptyLine, Swatch } from './components.tsx'

export function Saved() {
  const app = useApp()

  const exportCorrections = () => {
    // Corrections are exportable as JSON (spec F5); v1 does not feed them back.
    const blob = new Blob([JSON.stringify(app.corrections, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pigment-corrections.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const nameOf = (paintId: string) => {
    const tube = app.tubes.find((t) => t.paint?.id === paintId)
    if (tube) return tube.product_name
    return app.catalog?.paints.find((p) => p.id === paintId)?.product_name ?? paintId
  }

  return (
    <section>
      <header className="screen-head">
        <h2>Saved recipes</h2>
        {app.corrections.length > 0 && (
          <button className="ghost small" onClick={exportCorrections}>
            Export corrections ({app.corrections.length})
          </button>
        )}
      </header>

      {app.recipes.length === 0 ? (
        <EmptyLine>Recipes you save will appear here.</EmptyLine>
      ) : (
        <ul className="saved-grid">
          {app.recipes.map((r) => (
            <li key={r.id} className="card" onClick={() => app.nav({ name: 'recipe', recipe: r, saved: true })}>
              <div className="card-swatches">
                <Swatch hex={r.target_hex} size={44} label="target" />
                <Swatch hex={r.predicted_hex} size={44} label="predicted" />
              </div>
              <div className="card-main">
                <p className="ratio">{r.components.map((c) => `${c.parts} ${nameOf(c.paint_id)}`).join(' : ')}</p>
                <p className="row-sub">
                  ΔE {r.delta_e.toFixed(1)} · {new Date(r.saved_at).toLocaleDateString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
