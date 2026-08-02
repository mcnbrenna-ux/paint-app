import { useMemo, useState } from 'react'
import { useApp } from '../state/app.tsx'
import { EmptyLine, PigmentChips, Swatch } from './components.tsx'

const FAMILY_ORDER = ['white', 'yellow', 'orange', 'red', 'earth', 'green', 'blue', 'black', 'custom', 'other']

export function Inventory() {
  const app = useApp()
  const [adding, setAdding] = useState(false)

  const groups = useMemo(() => {
    const m = new Map<string, typeof app.tubes>()
    for (const t of app.tubes) {
      const key = FAMILY_ORDER.includes(t.hue_family) ? t.hue_family : 'other'
      m.set(key, [...(m.get(key) ?? []), t])
    }
    return FAMILY_ORDER.filter((f) => m.has(f)).map((f) => [f, m.get(f)!] as const)
  }, [app.tubes])

  return (
    <section>
      <header className="screen-head">
        <h2>Your tubes</h2>
        {app.tubes.length > 0 && (
          <button className="primary" onClick={() => setAdding(true)}>
            Add tube
          </button>
        )}
      </header>

      {app.catalogError && (
        <p className="warn-banner">
          The paint catalog failed to load — showing your inventory from this device. Adding new tubes needs the
          catalog; try reloading.
        </p>
      )}

      {app.catalogLoading ? (
        <ul className="rows" aria-label="Loading catalog">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="row skeleton">
              <span className="swatch shimmer" />
              <div className="row-main">
                <span className="shimmer-line" />
                <span className="shimmer-line short" />
              </div>
            </li>
          ))}
        </ul>
      ) : app.tubes.length === 0 ? (
        <div className="empty-block">
          <EmptyLine>
            Pigment predicts mixes from the actual tubes you own — it needs to know them before it can predict
            anything.
          </EmptyLine>
          <button className="primary big" onClick={() => setAdding(true)} disabled={!app.catalog}>
            Add your first tube
          </button>
          <button className="ghost" onClick={app.addStarter} disabled={!app.catalog}>
            Add a common starter palette (9 tubes)
          </button>
        </div>
      ) : (
        groups.map(([family, tubes]) => (
          <div key={family}>
            <h3 className="group-head">{family}</h3>
            <ul className="rows">
              {tubes.map((t) => (
                <li key={t.item.id} className={`row ${t.paint ? '' : 'dimmed'}`}>
                  <Swatch hex={t.masstone_hex} size={36} />
                  <div className="row-main">
                    <span className="row-title">
                      {t.product_name} {!t.paint && <em className="tag-unusable">can’t use this yet</em>}
                    </span>
                    <span className="row-sub">
                      {t.brand} · <PigmentChips ids={t.pigment_ids} />
                    </span>
                  </div>
                  <button className="ghost small" onClick={() => app.removeTube(t.item.id)} aria-label="Remove tube">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {app.unusableCount > 0 && (
        <p className="hint">
          {app.unusableCount} of your tubes can’t be used yet — the mix engine needs a known pigment code.
        </p>
      )}

      {adding && app.catalog && <AddTube onClose={() => setAdding(false)} />}
    </section>
  )
}

function AddTube({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [q, setQ] = useState('')
  const [customMode, setCustomMode] = useState(false)

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return app.catalog!.paints.slice(0, 12)
    return app.catalog!.paints
      .filter((p) =>
        `${p.brand} ${p.product_name} ${p.pigment_ids.join(' ')}`.toLowerCase().includes(needle),
      )
      .slice(0, 20)
  }, [q, app.catalog])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="screen-head">
          <h3>{customMode ? 'Add a tube we don’t know' : 'Add a tube'}</h3>
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        {customMode ? (
          <CustomTubeForm onDone={onClose} onBack={() => setCustomMode(false)} />
        ) : (
          <>
            <input
              autoFocus
              type="search"
              placeholder="Search brand or product name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="rows">
              {matches.map((p) => (
                <li key={p.id} className="row">
                  <Swatch hex={p.masstone_hex} size={30} />
                  <div className="row-main">
                    <span className="row-title">{p.product_name}</span>
                    <span className="row-sub">
                      {p.brand} · <PigmentChips ids={p.pigment_ids} />
                    </span>
                  </div>
                  <button
                    className="primary small"
                    onClick={() => {
                      app.addPaint(p.id)
                      onClose()
                    }}
                  >
                    Add
                  </button>
                </li>
              ))}
              {matches.length === 0 && <EmptyLine>No catalog match for “{q}”.</EmptyLine>}
            </ul>
            <button className="ghost" onClick={() => setCustomMode(true)}>
              My tube isn’t in the catalog
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CustomTubeForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const app = useApp()
  const [brand, setBrand] = useState('')
  const [name, setName] = useState('')
  const [pigs, setPigs] = useState<string[]>([])
  const [unknown, setUnknown] = useState(false)

  // A tube without a pigment code cannot be saved unless the user explicitly
  // selects "unknown pigment" (spec F1).
  const canSave = brand.trim() && name.trim() && (unknown || pigs.length > 0)

  return (
    <div className="custom-form">
      <label>
        Brand
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Old Holland" />
      </label>
      <label>
        Product name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kings Blue" />
      </label>
      <fieldset disabled={unknown}>
        <legend>Pigment codes (from the tube label)</legend>
        <div className="pig-grid">
          {app.catalog!.pigments.map((p) => (
            <label key={p.id} className="pig-check">
              <input
                type="checkbox"
                checked={pigs.includes(p.id)}
                onChange={(e) =>
                  setPigs((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))
                }
              />
              {p.id}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="pig-check">
        <input
          type="checkbox"
          checked={unknown}
          onChange={(e) => {
            setUnknown(e.target.checked)
            if (e.target.checked) setPigs([])
          }}
        />
        Unknown pigment — the label doesn’t say. (This tube will be excluded from mixing until identified.)
      </label>
      <div className="btn-row">
        <button className="ghost" onClick={onBack}>
          Back
        </button>
        <button
          className="primary"
          disabled={!canSave}
          onClick={() => {
            app.addCustom(brand.trim(), name.trim(), pigs, unknown)
            onDone()
          }}
        >
          Save tube
        </button>
      </div>
    </div>
  )
}
