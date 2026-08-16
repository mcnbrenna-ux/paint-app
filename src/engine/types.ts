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

/** A named, reloadable set of tubes (snapshot of inventory items). */
export interface Palette {
  id: string
  name: string
  items: InventoryItem[]
  created_at: number
}

/** A sampled spot on the reference photo, in canvas-relative coordinates. */
export interface ReferencePin {
  id: string
  x: number // 0..1
  y: number // 0..1
  hex: string
  /** true when the color went through an anchored profile correction. */
  calibrated?: boolean
}

/** The persistent reference photo and its sample pins. One per workspace. */
export interface ReferenceDoc {
  id: 'current'
  image: Blob
  pins: ReferencePin[]
  updated_at: number
  /**
   * The white-anchor tap for this photo, valid for one profile only. Every
   * photo carries its own anchor (calibration PRD §2.3); cleared when the
   * photo or the active profile changes.
   */
  anchor?: { x: number; y: number; r: number; g: number; b: number; profile_id: string } | null
}

// Lighting profiles (calibration PRD §3). Profiles are data, not enum values.
export type ProfileKind = 'artificial' | 'daylight'
export type AnchorKind = 'white_paint' | 'gray_card'

export interface SwatchCapture {
  /** FK to the tube record (InventoryItem.paint id or custom tube id). */
  pigmentId: string
  correctedLab: { L: number; a: number; b: number }
  /** Raw, uncorrected linear RGB — retained permanently for reprocessing (§3). */
  rawLinearRgb: { r: number; g: number; b: number }
  /**
   * The anchor as measured in the SAME frame as this swatch — required so a
   * revised algorithm can actually reprocess from raw without re-capture
   * (§3 / acceptance criterion 4): gains are per-frame, not per-profile.
   */
  rawAnchorLinearRgb: { r: number; g: number; b: number }
  capturedAt: number
}

export interface LightingProfile {
  id: string
  name: string
  createdAt: number
  lastVerifiedAt: number
  /** Linear RGB of the anchor measured at profile creation (§3). */
  anchorReference: { r: number; g: number; b: number }
  swatches: SwatchCapture[]
  /** User-editable, e.g. "overhead off, lamp at 4 o'clock". */
  notes: string
  /** §8: artificial light is stable, daylight is not — handled differently. */
  kind: ProfileKind
  /** §2: white paint dab by default; optional 18% gray card path. */
  anchorKind: AnchorKind
  /** §7: the default active profile is the most-used, not the most recent. */
  useCount: number
}

export type TargetOrigin = 'picker' | 'image_sample'

export interface Target {
  id: string
  srgb_hex: string
  oklab: [number, number, number]
  origin: TargetOrigin
  image_ref: string | null
  /** Set when the color went through a lighting profile's correction (AC5). */
  profile_name?: string
  profile_kind?: ProfileKind
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
  /** Lighting profile the target color was corrected through, if any (AC5). */
  profile_name?: string
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
