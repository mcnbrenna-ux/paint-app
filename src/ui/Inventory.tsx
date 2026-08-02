import { useMemo, useState } from 'react'
import { useApp } from '../state/app.tsx'
import { EmptyLine, PigmentChips, Swatch } from './components.tsx'

const FAMILY_ORDER = ['white', 'yellow', 'orange', 'red', 'earth', 'violet', 'green', 'blue', 'black', 'custom', 'other']

// Colour Index prefixes → display groups for the custom-tube pigment picker.
const PIGMENT_FAMILIES: [string, (id: string) => boolean][] = [
  ['Whites', (id) => id.startsWith('PW')],
  ['Yellows', (id) => id.startsWith('PY')],
  ['Oranges', (id) => id.startsWith('PO')],
  ['Reds', (id) => id.startsWith('PR')],
  ['Violets', (id) => id.startsWith('PV')],
  ['Blues', (id) => id.startsWith('PB') && !id.startsWith('PBk') && !id.startsWith('PBr')],
  ['Greens', (id) => id.startsWith('PG')],
  ['Earths', (id) => id.startsWith('PBr')],
  ['Blacks', (id) => id.startsWith('PBk')],
]

export function Inventory() {
  const app = useApp()
  const [adding, setAdding] = useState(false)
  const [savingPalette, setSavingPalette] = useState(false)
  const [paletteName, setPaletteName] = useState('')
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null)
  const [paletteError, setPaletteError] = useState<string | null>(null)

  const doSavePalette = (name: string) => {
    setPaletteError(null)
    app
      .savePalette(name)
      .then(() => {
        setPaletteName('')
        setSavingPalette(false)
      })
      .catch((e) => {
        setPaletteError(
          `Couldn’t save the palette to device storage: ${e instanceof Error ? e.message : String(e)}`,
        )
      })
  }

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

      {(app.palettes.length > 0 || app.tubes.length > 0) && (
        <div className="palette-bar">
          <span className="palette-label">Palettes</span>
          {app.palettes.map((p) =>
            confirmLoad === p.id ? (
              <span key={p.id} className="palette-confirm">
                Load “{p.name}” ({p.items.length} tubes)? Replaces your current {app.tubes.length}.
                <button
                  className="primary small"
                  onClick={() => {
                    app.loadPalette(p.id)
                    setConfirmLoad(null)
                  }}
                >
                  Load
                </button>
                <button className="ghost small" onClick={() => setConfirmLoad(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span key={p.id} className="palette-chip">
                <button className="ghost small" onClick={() => setConfirmLoad(p.id)}>
                  {p.name} ({p.items.length})
                </button>
                <button
                  className="ghost small chip-x"
                  aria-label={`Delete palette ${p.name}`}
                  onClick={() => app.deletePalette(p.id)}
                >
                  ×
                </button>
              </span>
            ),
          )}
          {app.tubes.length > 0 &&
            (savingPalette ? (
              <span className="palette-confirm">
                <input
                  autoFocus
                  value={paletteName}
                  onChange={(e) => setPaletteName(e.target.value)}
                  placeholder="Palette name, e.g. Plein air"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && paletteName.trim()) doSavePalette(paletteName.trim())
                  }}
                />
                <button
                  className="primary small"
                  disabled={!paletteName.trim()}
                  onClick={() => doSavePalette(paletteName.trim())}
                >
                  Save
                </button>
                <button className="ghost small" onClick={() => setSavingPalette(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="ghost small" onClick={() => setSavingPalette(true)}>
                + Save current as palette
              </button>
            ))}
        </div>
      )}
      {paletteError && (
        <p className="inline-error" role="alert">
          {paletteError}
        </p>
      )}

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
  const [brand, setBrand] = useState<string | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})

  const brands = useMemo(() => [...new Set(app.catalog!.paints.map((p) => p.brand))], [app.catalog])
  const ownedPaintIds = useMemo(() => new Set(app.inventory.map((i) => i.paint_id)), [app.inventory])

  // The full catalog is browsable, grouped by hue family — search and brand
  // filters narrow it rather than capping it.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const matches = app.catalog!.paints.filter(
      (p) =>
        (!brand || p.brand === brand) &&
        (!needle || `${p.brand} ${p.product_name} ${p.pigment_ids.join(' ')}`.toLowerCase().includes(needle)),
    )
    const m = new Map<string, typeof matches>()
    for (const p of matches) m.set(p.hue_family, [...(m.get(p.hue_family) ?? []), p])
    return FAMILY_ORDER.filter((f) => m.has(f)).map(
      (f) => [f, m.get(f)!.sort((a, b) => a.product_name.localeCompare(b.product_name))] as const,
    )
  }, [q, brand, app.catalog])

  const total = groups.reduce((n, [, list]) => n + list.length, 0)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="screen-head">
          <h3>{customMode ? 'Add a tube we don’t know' : `Add a tube (${total} in catalog)`}</h3>
          <button className="ghost small" onClick={onClose}>
            Done
          </button>
        </header>
        {customMode ? (
          <CustomTubeForm onDone={onClose} onBack={() => setCustomMode(false)} />
        ) : (
          <>
            <input
              autoFocus
              type="search"
              placeholder="Search product name, brand, or pigment code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="brand-filter">
              <button className={`ghost small ${brand === null ? 'active' : ''}`} onClick={() => setBrand(null)}>
                All brands
              </button>
              {brands.map((b) => (
                <button
                  key={b}
                  className={`ghost small ${brand === b ? 'active' : ''}`}
                  onClick={() => setBrand(brand === b ? null : b)}
                >
                  {b}
                </button>
              ))}
            </div>
            {groups.map(([family, paints]) => (
              <div key={family}>
                <h4 className="group-head">{family}</h4>
                <ul className="rows">
                  {paints.map((p) => {
                    const owned = ownedPaintIds.has(p.id) || added[p.id]
                    return (
                      <li key={p.id} className="row">
                        <Swatch hex={p.masstone_hex} size={30} />
                        <div className="row-main">
                          <span className="row-title">{p.product_name}</span>
                          <span className="row-sub">
                            {p.brand} · <PigmentChips ids={p.pigment_ids} />
                          </span>
                        </div>
                        <button
                          className={owned ? 'ghost small' : 'primary small'}
                          disabled={!!owned}
                          onClick={() => {
                            app.addPaint(p.id)
                            setAdded((a) => ({ ...a, [p.id]: true }))
                          }}
                        >
                          {owned ? 'Added ✓' : 'Add'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {total === 0 && <EmptyLine>No catalog match for “{q}”.</EmptyLine>}
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
        {PIGMENT_FAMILIES.map(([label, prefixTest]) => {
          const members = app.catalog!.pigments.filter((p) => prefixTest(p.id))
          if (!members.length) return null
          return (
            <div key={label}>
              <h4 className="group-head">{label}</h4>
              <div className="pig-grid wide">
                {members.map((p) => (
                  <label key={p.id} className="pig-check">
                    <input
                      type="checkbox"
                      checked={pigs.includes(p.id)}
                      onChange={(e) =>
                        setPigs((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))
                      }
                    />
                    <span>
                      <strong>{p.id}</strong> · {p.common_name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
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
