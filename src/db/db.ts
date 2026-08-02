// IndexedDB persistence (spec §2, §7): inventory, saved recipes, corrections,
// named palettes, and the reference-photo workspace. No backend, no sync —
// offline at the easel is the whole point.

import type { Correction, InventoryItem, Palette, Recipe, ReferenceDoc } from '../engine/types.ts'

const DB_NAME = 'pigment'
const DB_VERSION = 2
const STORES = ['inventory', 'recipes', 'corrections', 'palettes', 'reference'] as const
type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name)) {
            req.result.createObjectStore(name, { keyPath: 'id' })
          }
        }
      }
      req.onsuccess = () => {
        // If a newer app version needs to upgrade the schema, close this
        // connection so its upgrade isn't blocked forever.
        req.result.onversionchange = () => {
          req.result.close()
          dbPromise = null
        }
        resolve(req.result)
      }
      req.onerror = () => reject(req.error ?? new Error('Device storage refused to open'))
      // An older app version (another tab, or the installed home-screen copy)
      // is holding the database open — waiting silently would hang every save.
      req.onblocked = () =>
        reject(
          new Error(
            'Another open copy of Pigment is blocking a storage upgrade. Close other tabs or the installed app, then reload.',
          ),
        )
    })
    // Let a later call retry rather than caching the failure forever.
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Replace a store's entire contents in one transaction (palette load). */
function replaceAll(store: StoreName, items: { id: string }[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite')
        const s = t.objectStore(store)
        s.clear()
        for (const item of items) s.put(item)
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      }),
  )
}

export const db = {
  getAllInventory: () => tx<InventoryItem[]>('inventory', 'readonly', (s) => s.getAll()),
  putInventory: (item: InventoryItem) => tx('inventory', 'readwrite', (s) => s.put(item)),
  deleteInventory: (id: string) => tx('inventory', 'readwrite', (s) => s.delete(id)),
  replaceInventory: (items: InventoryItem[]) => replaceAll('inventory', items),

  getAllRecipes: () => tx<Recipe[]>('recipes', 'readonly', (s) => s.getAll()),
  putRecipe: (r: Recipe) => tx('recipes', 'readwrite', (s) => s.put(r)),
  deleteRecipe: (id: string) => tx('recipes', 'readwrite', (s) => s.delete(id)),

  getAllCorrections: () => tx<Correction[]>('corrections', 'readonly', (s) => s.getAll()),
  putCorrection: (c: Correction) => tx('corrections', 'readwrite', (s) => s.put(c)),

  getAllPalettes: () => tx<Palette[]>('palettes', 'readonly', (s) => s.getAll()),
  putPalette: (p: Palette) => tx('palettes', 'readwrite', (s) => s.put(p)),
  deletePalette: (id: string) => tx('palettes', 'readwrite', (s) => s.delete(id)),

  getReference: () =>
    tx<ReferenceDoc | undefined>('reference', 'readonly', (s) => s.get('current') as IDBRequest<ReferenceDoc | undefined>),
  putReference: (r: ReferenceDoc) => tx('reference', 'readwrite', (s) => s.put(r)),
  deleteReference: () => tx('reference', 'readwrite', (s) => s.delete('current')),
}

export function uid(): string {
  return crypto.randomUUID()
}
