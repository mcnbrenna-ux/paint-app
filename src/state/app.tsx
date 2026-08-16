import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadCatalog, resolveTube, STARTER_PALETTE_IDS, type Catalog, type ResolvedTube } from '../data/catalog.ts'
import { db, uid } from '../db/db.ts'
import type {
  AnchorKind,
  Correction,
  CorrectionAxis,
  CorrectionMagnitude,
  InventoryItem,
  LightingProfile,
  Paint,
  Palette,
  ProfileKind,
  Recipe,
  ReferenceDoc,
  ReferencePin,
  SwatchCapture,
  Target,
} from '../engine/types.ts'

export type Route =
  | { name: 'inventory' }
  | { name: 'target' }
  | { name: 'results'; target: Target }
  | { name: 'recipe'; recipe: Recipe; saved: boolean }
  | { name: 'saved' }
  | { name: 'profiles' }

interface AppState {
  catalog: Catalog | null
  catalogLoading: boolean
  catalogError: boolean
  inventory: InventoryItem[]
  tubes: ResolvedTube[]
  usablePaints: Paint[]
  unusableCount: number
  addPaint: (paintId: string) => void
  addStarter: () => void
  addCustom: (brand: string, name: string, pigmentIds: string[], unknownPigment: boolean) => void
  removeTube: (itemId: string) => void
  palettes: Palette[]
  savePalette: (name: string) => Promise<void>
  loadPalette: (id: string) => void
  deletePalette: (id: string) => void
  profiles: LightingProfile[]
  activeProfile: LightingProfile | null
  setActiveProfile: (id: string | null, countUse?: boolean) => void
  createProfile: (
    name: string,
    kind: ProfileKind,
    anchorKind: AnchorKind,
    anchor: { r: number; g: number; b: number },
  ) => LightingProfile
  updateProfile: (id: string, patch: Partial<Pick<LightingProfile, 'name' | 'notes'>>) => void
  deleteProfile: (id: string) => void
  reshootAnchor: (id: string, anchor: { r: number; g: number; b: number }) => void
  addSwatch: (id: string, capture: SwatchCapture) => void
  reference: ReferenceDoc | null
  setReferenceImage: (image: Blob) => void
  setReferenceAnchor: (anchor: NonNullable<ReferenceDoc['anchor']> | null) => void
  addReferencePin: (pin: Omit<ReferencePin, 'id'>) => ReferencePin
  removeReferencePin: (pinId: string) => void
  clearReference: () => void
  recipes: Recipe[]
  saveRecipe: (r: Recipe) => Promise<void>
  corrections: Correction[]
  addCorrection: (recipe: Recipe, axis: CorrectionAxis, magnitude: CorrectionMagnitude) => void
  route: Route
  nav: (r: Route) => void
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [palettes, setPalettes] = useState<Palette[]>([])
  const [profiles, setProfiles] = useState<LightingProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(
    () => localStorage.getItem('pigment-active-profile'),
  )
  const [reference, setReference] = useState<ReferenceDoc | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [route, nav] = useState<Route>({ name: 'inventory' })

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch(() => setCatalogError(true))
      .finally(() => setCatalogLoading(false))
    db.getAllInventory().then(setInventory).catch(() => {})
    db.getAllPalettes()
      .then((p) => setPalettes(p.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {})
    db.getAllProfiles()
      .then((ps) => {
        // §2.4: two profiles ship as defaults. They arrive needing their
        // anchor shot (lastVerifiedAt 0 = "needs setup"); the count is not fixed.
        if (ps.length === 0 && !localStorage.getItem('pigment-profiles-seeded')) {
          const mk = (name: string, kind: ProfileKind): LightingProfile => ({
            id: uid(),
            name,
            createdAt: Date.now(),
            lastVerifiedAt: 0,
            anchorReference: { r: 0, g: 0, b: 0 },
            swatches: [],
            notes: '',
            kind,
            anchorKind: 'white_paint',
            useCount: 0,
          })
          const defaults = [mk('Evening — lamp', 'artificial'), mk('Daylight — window', 'daylight')]
          defaults.forEach((p) => db.putProfile(p))
          localStorage.setItem('pigment-profiles-seeded', '1')
          setProfiles(defaults)
        } else {
          setProfiles(ps)
        }
      })
      .catch(() => {})
    db.getReference()
      .then((r) => setReference(r ?? null))
      .catch(() => {})
    db.getAllRecipes().then((r) => setRecipes(r.sort((a, b) => b.saved_at - a.saved_at))).catch(() => {})
    db.getAllCorrections().then(setCorrections).catch(() => {})
  }, [])

  const tubes = useMemo(
    () =>
      inventory
        .map((i) => resolveTube(i, catalog))
        .sort((a, b) => a.hue_family.localeCompare(b.hue_family) || a.product_name.localeCompare(b.product_name)),
    [inventory, catalog],
  )
  const usablePaints = useMemo(() => tubes.map((t) => t.paint).filter((p): p is Paint => !!p), [tubes])
  const unusableCount = tubes.length - usablePaints.length

  const addPaint = useCallback(
    (paintId: string) => {
      const paint = catalog?.paints.find((p) => p.id === paintId)
      if (!paint) return
      const item: InventoryItem = {
        id: uid(),
        paint_id: paintId,
        added_at: Date.now(),
        usable: true,
        snapshot: {
          brand: paint.brand,
          product_name: paint.product_name,
          pigment_ids: paint.pigment_ids,
          hue_family: paint.hue_family,
          masstone_hex: paint.masstone_hex,
        },
      }
      setInventory((inv) => [...inv, item])
      db.putInventory(item)
    },
    [catalog],
  )

  const addStarter = useCallback(() => {
    for (const id of STARTER_PALETTE_IDS) addPaint(id)
  }, [addPaint])

  const addCustom = useCallback(
    (brand: string, name: string, pigmentIds: string[], unknownPigment: boolean) => {
      const item: InventoryItem = {
        id: uid(),
        paint_id: '',
        added_at: Date.now(),
        // Unknown-pigment tubes are excluded from the mix engine (spec F1).
        usable: !unknownPigment && pigmentIds.length > 0,
        custom: { brand, product_name: name, pigment_ids: pigmentIds, unknown_pigment: unknownPigment },
      }
      setInventory((inv) => [...inv, item])
      db.putInventory(item)
    },
    [],
  )

  const removeTube = useCallback((itemId: string) => {
    setInventory((inv) => inv.filter((i) => i.id !== itemId))
    db.deleteInventory(itemId)
  }, [])

  const savePalette = useCallback(
    async (name: string) => {
      const p: Palette = { id: uid(), name, items: inventory, created_at: Date.now() }
      setPalettes((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name)))
      try {
        await db.putPalette(p)
      } catch (e) {
        // Roll back the optimistic chip so the UI never lies about what's on disk.
        setPalettes((ps) => ps.filter((x) => x.id !== p.id))
        throw e
      }
    },
    [inventory],
  )

  const loadPalette = useCallback(
    (id: string) => {
      const p = palettes.find((x) => x.id === id)
      if (!p) return
      setInventory(p.items)
      db.replaceInventory(p.items)
    },
    [palettes],
  )

  const deletePalette = useCallback((id: string) => {
    setPalettes((ps) => ps.filter((p) => p.id !== id))
    db.deletePalette(id)
  }, [])

  const patchProfile = useCallback((id: string, fn: (p: LightingProfile) => LightingProfile) => {
    setProfiles((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p
        const next = fn(p)
        db.putProfile(next)
        return next
      }),
    )
  }, [])

  const setActiveProfile = useCallback((id: string | null, countUse = true) => {
    setActiveProfileId(id)
    if (id) {
      localStorage.setItem('pigment-active-profile', id)
      // §7: default to most-used — only explicit user picks count as use,
      // so the automatic default can't inflate its own ranking.
      if (countUse) {
        setProfiles((ps) =>
          ps.map((p) => {
            if (p.id !== id) return p
            const next = { ...p, useCount: p.useCount + 1 }
            db.putProfile(next)
            return next
          }),
        )
      }
    } else {
      localStorage.removeItem('pigment-active-profile')
    }
  }, [])

  const createProfile = useCallback(
    (name: string, kind: ProfileKind, anchorKind: AnchorKind, anchor: { r: number; g: number; b: number }) => {
      const p: LightingProfile = {
        id: uid(),
        name,
        createdAt: Date.now(),
        lastVerifiedAt: Date.now(),
        anchorReference: anchor,
        swatches: [],
        notes: '',
        kind,
        anchorKind,
        useCount: 0,
      }
      setProfiles((ps) => [...ps, p])
      db.putProfile(p)
      return p
    },
    [],
  )

  const updateProfile = useCallback(
    (id: string, patch: Partial<Pick<LightingProfile, 'name' | 'notes'>>) => {
      patchProfile(id, (p) => ({ ...p, ...patch }))
    },
    [patchProfile],
  )

  const deleteProfile = useCallback(
    (id: string) => {
      // AC3: swatches are embedded in the record — they die with it.
      setProfiles((ps) => ps.filter((p) => p.id !== id))
      db.deleteProfile(id)
      setActiveProfileId((cur) => {
        if (cur === id) {
          localStorage.removeItem('pigment-active-profile')
          return null
        }
        return cur
      })
    },
    [],
  )

  const reshootAnchor = useCallback(
    (id: string, anchor: { r: number; g: number; b: number }) => {
      // §8: one-tap anchor re-shoot updates the reference without touching swatches.
      patchProfile(id, (p) => ({ ...p, anchorReference: anchor, lastVerifiedAt: Date.now() }))
    },
    [patchProfile],
  )

  const addSwatch = useCallback(
    (id: string, capture: SwatchCapture) => {
      patchProfile(id, (p) => ({
        ...p,
        // one capture per tube: a re-shoot replaces the old capture
        swatches: [...p.swatches.filter((s) => s.pigmentId !== capture.pigmentId), capture],
      }))
    },
    [patchProfile],
  )

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null

  const setReferenceImage = useCallback((image: Blob) => {
    const doc: ReferenceDoc = { id: 'current', image, pins: [], updated_at: Date.now() }
    setReference(doc)
    db.putReference(doc)
  }, [])

  const setReferenceAnchor = useCallback((anchor: NonNullable<ReferenceDoc['anchor']> | null) => {
    setReference((r) => {
      if (!r) return r
      const doc: ReferenceDoc = { ...r, anchor, updated_at: Date.now() }
      db.putReference(doc)
      return doc
    })
  }, [])

  const addReferencePin = useCallback(
    (pin: Omit<ReferencePin, 'id'>): ReferencePin => {
      const full: ReferencePin = { ...pin, id: uid() }
      setReference((r) => {
        if (!r) return r
        const doc: ReferenceDoc = { ...r, pins: [...r.pins, full], updated_at: Date.now() }
        db.putReference(doc)
        return doc
      })
      return full
    },
    [],
  )

  const removeReferencePin = useCallback((pinId: string) => {
    setReference((r) => {
      if (!r) return r
      const doc: ReferenceDoc = { ...r, pins: r.pins.filter((p) => p.id !== pinId), updated_at: Date.now() }
      db.putReference(doc)
      return doc
    })
  }, [])

  const clearReference = useCallback(() => {
    setReference(null)
    db.deleteReference()
  }, [])

  const saveRecipe = useCallback(async (r: Recipe) => {
    setRecipes((rs) => [r, ...rs.filter((x) => x.id !== r.id)])
    await db.putRecipe(r)
  }, [])

  const addCorrection = useCallback((recipe: Recipe, axis: CorrectionAxis, magnitude: CorrectionMagnitude) => {
    const c: Correction = {
      id: uid(),
      recipe_id: recipe.id,
      paint_ids: recipe.components.map((x) => x.paint_id),
      axis,
      magnitude,
      created_at: Date.now(),
    }
    setCorrections((cs) => [...cs, c])
    db.putCorrection(c)
  }, [])

  const value: AppState = {
    catalog,
    catalogLoading,
    catalogError,
    inventory,
    tubes,
    usablePaints,
    unusableCount,
    addPaint,
    addStarter,
    addCustom,
    removeTube,
    palettes,
    savePalette,
    loadPalette,
    deletePalette,
    profiles,
    activeProfile,
    setActiveProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    reshootAnchor,
    addSwatch,
    reference,
    setReferenceImage,
    setReferenceAnchor,
    addReferencePin,
    removeReferencePin,
    clearReference,
    recipes,
    saveRecipe,
    corrections,
    addCorrection,
    route,
    nav,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
