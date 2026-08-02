// Domain types (spec §5 data model).

export type Transparency = 'opaque' | 'semi-opaque' | 'semi-transparent' | 'transparent'
export type DataSource = 'manufacturer_published' | 'measured' | 'estimated'
export type ConfidenceBand = 'high' | 'medium' | 'low'

export interface Pigment {
  /** Colour Index code, e.g. PB29, PB15:3, PY35, PW6. */
  id: string
  common_name: string
  transparency: Transparency
  /** K/S per band; length = band count (3 in v1). */
  ks_coefficients: number[]
  notes?: string
}

export interface Paint {
  id: string
  brand: string
  product_name: string
  medium: 'oil'
  /** Multi-pigment tubes are first-class. */
  pigment_ids: string[]
  opacity: Transparency
  /** 1.0 = titanium white reference. */
  tinting_strength: number
  /** Per-tube fitted K/S; length = band count. */
  ks: number[]
  /** Masstone as displayable hex (for swatches in the catalog UI). */
  masstone_hex: string
  source: DataSource
  confidence: number
  hue_family: string
}

export interface InventoryItem {
  id: string
  paint_id: string
  added_at: number
  /** false when pigment data is incomplete — excluded from the mix engine. */
  usable: boolean
  /** Set for user-added custom tubes that aren't in the catalog. */
  custom?: {
    brand: string
    product_name: string
    pigment_ids: string[] // empty + unknown_pigment=true means unusable
    unknown_pigment: boolean
  }
  /**
   * Denormalized display data captured at add time, so the inventory stays
   * readable from local storage even if the catalog fails to load (spec §6).
   */
  snapshot?: {
    brand: string
    product_name: string
    pigment_ids: string[]
    hue_family: string
    masstone_hex: string
  }
}

export type TargetOrigin = 'picker' | 'image_sample'

export interface Target {
  id: string
  srgb_hex: string
  oklab: [number, number, number]
  origin: TargetOrigin
  image_ref: string | null
}

export interface RecipeComponent {
  paint_id: string
  parts: number
}

export interface Recipe {
  id: string
  target_id: string
  target_hex: string
  target_origin: TargetOrigin
  components: RecipeComponent[]
  predicted_oklab: [number, number, number]
  predicted_hex: string
  delta_e: number
  confidence_band: ConfidenceBand
  saved_at: number
}

export type CorrectionAxis = 'lighter' | 'darker' | 'warmer' | 'cooler' | 'duller' | 'more_saturated'
export type CorrectionMagnitude = 'slight' | 'obvious'

export interface Correction {
  id: string
  recipe_id: string
  /** Denormalized so corrections stay attributable if a recipe is deleted. */
  paint_ids: string[]
  axis: CorrectionAxis
  magnitude: CorrectionMagnitude
  created_at: number
}
