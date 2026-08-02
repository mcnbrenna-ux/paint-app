import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadCatalog, resolveTube, STARTER_PALETTE_IDS, type Catalog, type ResolvedTube } from '../data/catalog.ts'
import { db, uid } from '../db/db.ts'
import type {
  Correction,
  CorrectionAxis,
  CorrectionMagnitude,
  InventoryItem,
  Paint,
  Palette,
  Recipe,
  ReferenceDoc,
  ReferencePin,
  Target,
} from '../engine/types.ts'

export type Route =
  | { name: 'inventory' }
  | { name: 'target' }
  | { name: 'results'; target: Target }
  | { name: 'recipe'; recipe: Recipe; saved: boolean }
  | { name: 'saved' }

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
  savePalette: (name: string) => void
  loadPalette: (id: string) => void
  deletePalette: (id: string) => void
  reference: ReferenceDoc | null
  setReferenceImage: (image: Blob) => void
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
    (name: string) => {
      const p: Palette = { id: uid(), name, items: inventory, created_at: Date.now() }
      setPalettes((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name)))
      db.putPalette(p)
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

  const setReferenceImage = useCallback((image: Blob) => {
    const doc: ReferenceDoc = { id: 'current', image, pins: [], updated_at: Date.now() }
    setReference(doc)
    db.putReference(doc)
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
    reference,
    setReferenceImage,
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
