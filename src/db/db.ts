// IndexedDB persistence (spec §2, §7): inventory, saved recipes, corrections.
// No backend, no sync — offline at the easel is the whole point.

import type { Correction, InventoryItem, Recipe } from '../engine/types.ts'

const DB_NAME = 'pigment'
const DB_VERSION = 1
const STORES = ['inventory', 'recipes', 'corrections'] as const
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
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
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

export const db = {
  getAllInventory: () => tx<InventoryItem[]>('inventory', 'readonly', (s) => s.getAll()),
  putInventory: (item: InventoryItem) => tx('inventory', 'readwrite', (s) => s.put(item)),
  deleteInventory: (id: string) => tx('inventory', 'readwrite', (s) => s.delete(id)),

  getAllRecipes: () => tx<Recipe[]>('recipes', 'readonly', (s) => s.getAll()),
  putRecipe: (r: Recipe) => tx('recipes', 'readwrite', (s) => s.put(r)),
  deleteRecipe: (id: string) => tx('recipes', 'readwrite', (s) => s.delete(id)),

  getAllCorrections: () => tx<Correction[]>('corrections', 'readonly', (s) => s.getAll()),
  putCorrection: (c: Correction) => tx('corrections', 'readwrite', (s) => s.put(c)),
}

export function uid(): string {
  return crypto.randomUUID()
}
