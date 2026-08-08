// Guidance engine (spec §8): a deterministic rule tree over a closed stage
// taxonomy. No LLM calls, no server. Rules are static content authored in
// /content/guidance/*.json and reviewed like code. The guidance layer never
// invents color math — mix steps emit ColorTargets for the v1 engine.

export const STAGES = [
  'TONED_GROUND',
  'DRAWING_TRANSFER',
  'UNDERPAINTING',
  'BLOCK_IN',
  'FIRST_PAINTING',
  'GLAZING',
  'SCUMBLING',
  'DETAILS_FINAL',
] as const
export type Stage = (typeof STAGES)[number]

// Medium-fat index per stage (0 = leanest). Fat-over-lean is enforced as a
// hard precondition: a target layer leaner than the declared current layer
// emits a BLOCKING caution, not a suggestion.
export const STAGE_FAT_INDEX: Record<Stage, number> = {
  TONED_GROUND: 0,
  DRAWING_TRANSFER: 0,
  UNDERPAINTING: 0,
  BLOCK_IN: 1,
  FIRST_PAINTING: 2,
  GLAZING: 3,
  SCUMBLING: 3,
  DETAILS_FINAL: 3,
}

export const CAUTIONS = {
  fat_over_lean:
    'Fat over lean: every layer must be at least as oil-rich as the one beneath it, or the film cracks as it cures.',
  drying_window:
    'Drying times are ranges, not promises — pigment, film thickness, and room conditions all move them.',
  glaze_over_dry_only:
    'Glaze only over paint that is dry to firm touch with no drag. A glaze over soft paint lifts and muddies it.',
  scumble_pressure: 'Scumble with a nearly dry brush and light pressure — the underlayer must stay visible.',
  solvent_sparingly:
    'Solvent-heavy passages dry matte and underbound. Past the first layers, add oil, not solvent.',
} as const
export type CautionRef = keyof typeof CAUTIONS

export interface ColorTarget {
  label: string
  /** Feeds the existing v1 recipe engine as a target. */
  hex: string
}

export interface GuidanceStep {
  ordinal: number
  instruction: string
  mixTargets?: ColorTarget[]
  previewTransform?: {
    thicknessClass: 'glaze' | 'thinScumble' | 'opaque'
    mediumLoad: number
  }
}

export interface GuidanceRule {
  id: string
  fromStage: Stage
  toStage: Stage
  preconditions: string[]
  steps: GuidanceStep[]
  cautions: CautionRef[]
  dryingWindow?: { min_days: number; max_days: number }
}

export const KNOWN_PRECONDITIONS = new Set([
  'layerDrynessDeclared', // user has declared the current layer dry to touch
  'paletteDefined', // usable tubes exist in inventory
  'valueRangeCheck', // underpainting value structure declared complete
])

export interface RuleEvaluation {
  rule: GuidanceRule
  /** Blocking cautions that must be resolved before the steps apply. */
  blocking: string[]
}

/** Fat-over-lean hard gate plus precondition surface. */
export function evaluateRule(rule: GuidanceRule, declared: { currentStage: Stage; layerDry: boolean }): RuleEvaluation {
  const blocking: string[] = []
  if (STAGE_FAT_INDEX[rule.toStage] < STAGE_FAT_INDEX[declared.currentStage]) {
    blocking.push(CAUTIONS.fat_over_lean)
  }
  if (rule.preconditions.includes('layerDrynessDeclared') && !declared.layerDry) {
    blocking.push('The current layer must be dry to touch before this step — declare dryness once it is.')
  }
  return { rule, blocking }
}

export function validateRule(rule: GuidanceRule): string[] {
  const problems: string[] = []
  if (!STAGES.includes(rule.fromStage)) problems.push(`unknown fromStage ${rule.fromStage}`)
  if (!STAGES.includes(rule.toStage)) problems.push(`unknown toStage ${rule.toStage}`)
  for (const p of rule.preconditions) if (!KNOWN_PRECONDITIONS.has(p)) problems.push(`unknown precondition ${p}`)
  for (const c of rule.cautions) if (!(c in CAUTIONS)) problems.push(`unknown caution ${c}`)
  if (rule.steps.length === 0) problems.push('rule has no steps')
  rule.steps.forEach((s, i) => {
    if (s.ordinal !== i + 1) problems.push(`step ordinals out of order at index ${i}`)
    if (!s.instruction.trim()) problems.push(`empty instruction at ordinal ${s.ordinal}`)
    for (const t of s.mixTargets ?? []) {
      if (!/^#[0-9a-f]{6}$/i.test(t.hex)) problems.push(`bad mixTarget hex ${t.hex}`)
    }
  })
  // Fat-over-lean sanity of the transition itself: going leaner requires the
  // rule to carry the caution explicitly.
  if (STAGE_FAT_INDEX[rule.toStage] < STAGE_FAT_INDEX[rule.fromStage] && !rule.cautions.includes('fat_over_lean')) {
    problems.push('transition goes leaner without carrying fat_over_lean caution')
  }
  return problems
}
