// Catalog loading + inventory resolution. The catalog ships inside the bundle
// (dynamic import so the inventory screen can render skeleton rows while it
// loads, and show the non-blocking error banner if it ever fails).

import type { InventoryItem, Paint, Pigment } from '../engine/types.ts'

export interface Catalog {
  version: number
  bands: number
  pigments: Pigment[]
  paints: Paint[]
}

export async function loadCatalog(): Promise<Catalog> {
  const mod = await import('./catalog.json')
  const cat = mod.default as unknown as Catalog
  if (!cat?.paints?.length) throw new Error('catalog is empty')
  return cat
}

export interface ResolvedTube {
  item: InventoryItem
  /** Engine-ready paint; null when the tube can't be used (unknown pigment / unresolvable). */
  paint: Paint | null
  brand: string
  product_name: string
  pigment_ids: string[]
  hue_family: string
  masstone_hex: string
}

/** Build an engine paint for a custom tube from pigment-level K/S fallback data. */
function customPaint(item: InventoryItem, catalog: Catalog): Paint | null {
  const custom = item.custom!
  if (custom.unknown_pigment || custom.pigment_ids.length === 0) return null
  const pigs = custom.pigment_ids
    .map((id) => catalog.pigments.find((p) => p.id === id))
    .filter((p): p is Pigment => !!p && p.ks_coefficients.length > 0)
  if (pigs.length === 0) return null
  const ks = new Array(catalog.bands).fill(0)
  for (const p of pigs) for (let b = 0; b < catalog.bands; b++) ks[b] += p.ks_coefficients[b] / pigs.length
  // Tinting strength: average of catalog tubes led by the same pigment, else a
  // conservative middle value.
  const siblings = catalog.paints.filter((p) => p.pigment_ids[0] === custom.pigment_ids[0])
  const strength = siblings.length
    ? siblings.reduce((a, p) => a + p.tinting_strength, 0) / siblings.length
    : 0.5
  return {
    id: item.id,
    brand: custom.brand,
    product_name: custom.product_name,
    medium: 'oil',
    pigment_ids: custom.pigment_ids,
    opacity: pigs[0].transparency,
    tinting_strength: Number(strength.toFixed(3)),
    ks,
    masstone_hex: '#888888',
    source: 'estimated',
    confidence: 0.3,
    hue_family: 'custom',
  }
}

export function resolveTube(item: InventoryItem, catalog: Catalog | null): ResolvedTube {
  if (item.custom) {
    const paint = catalog ? customPaint(item, catalog) : null
    return {
      item,
      paint: item.usable ? paint : null,
      brand: item.custom.brand,
      product_name: item.custom.product_name,
      pigment_ids: item.custom.unknown_pigment ? [] : item.custom.pigment_ids,
      hue_family: 'custom',
      masstone_hex: paint?.masstone_hex ?? '#888888',
    }
  }
  const paint = catalog?.paints.find((p) => p.id === item.paint_id) ?? null
  const snap = item.snapshot
  return {
    item,
    paint: item.usable ? paint : null,
    brand: paint?.brand ?? snap?.brand ?? 'Unknown brand',
    product_name: paint?.product_name ?? snap?.product_name ?? item.paint_id,
    pigment_ids: paint?.pigment_ids ?? snap?.pigment_ids ?? [],
    hue_family: paint?.hue_family ?? snap?.hue_family ?? 'other',
    masstone_hex: paint?.masstone_hex ?? snap?.masstone_hex ?? '#888888',
  }
}

/** ids of a sensible starter palette (one-tap add for the empty state, spec §6). */
export const STARTER_PALETTE_IDS = [
  'winsor-newton-titanium-white',
  'winsor-newton-french-ultramarine',
  'winsor-newton-cadmium-yellow-light',
  'winsor-newton-yellow-ochre',
  'winsor-newton-cadmium-red',
  'winsor-newton-alizarin-crimson',
  'winsor-newton-burnt-sienna',
  'winsor-newton-raw-umber',
  'winsor-newton-ivory-black',
]
