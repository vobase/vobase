/**
 * Sensitivity model for change-proposal routing.
 *
 * Replaces the binary `requiresApproval` flag with a typed level. Each
 * resource (and optionally individual scalar columns / per-tenant attribute
 * keys) declares a sensitivity; `insertProposal` combines that with the
 * agent-supplied `confidence` to route a proposal to one of three outcomes:
 *
 *   - `'drop'`         — confidence below the trivia gate (cheap-model triage
 *                        emits a low score for noise like "@MeriGPT hi")
 *   - `'pending'`      — middle band; lands on `/changes` for human review
 *   - `'auto_written'` — high confidence relative to the resource's auto bar
 *
 * The auto bar is derived **additively**: `T_AUTO_BASE + sLevel × HEADROOM`.
 * The multiplicative form `c × (1 − s)` was rejected because a `'critical'`
 * resource would force every proposal to `'drop'`, conflating the trivia gate
 * with the approval gate. Sensitivity should only raise the auto threshold,
 * never silence high-confidence proposals.
 *
 * Calibration knobs (`T_REVIEW`, `T_AUTO_BASE`, `SENSITIVITY_HEADROOM`) and
 * the level→number map (`SENSITIVITY_LEVELS`) read from env at module load.
 * Slice 2 will move them behind `wake/learning/thresholds.ts`.
 */

export type Sensitivity = 'low' | 'medium' | 'high' | 'critical'

const SENSITIVITY_ORDER: readonly Sensitivity[] = ['low', 'medium', 'high', 'critical']

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Confidence floor — proposals below this drop silently regardless of sensitivity. */
export const T_REVIEW = envNumber('LEARN_T_REVIEW', 0.3)

/** Base auto-apply threshold — sensitivity 'low' starts here. */
export const T_AUTO_BASE = envNumber('LEARN_T_AUTO_BASE', 0.7)

/** Each sensitivity level raises the auto bar by `HEADROOM × levelValue`. */
export const SENSITIVITY_HEADROOM = envNumber('LEARN_S_HEADROOM', 0.3)

export const SENSITIVITY_LEVELS: Record<Sensitivity, number> = {
  low: envNumber('LEARN_LEVEL_LOW', 0.2),
  medium: envNumber('LEARN_LEVEL_MEDIUM', 0.4),
  high: envNumber('LEARN_LEVEL_HIGH', 0.7),
  critical: envNumber('LEARN_LEVEL_CRITICAL', 0.95),
}

export type RouteOutcome = 'auto_written' | 'pending' | 'drop'

/**
 * Decide where a proposal lands given its confidence and the resolved
 * effective sensitivity. Pure function — no DB access. See module doc-comment
 * for the rationale behind the additive formula.
 */
export function routeStatus(confidence: number, effectiveSensitivity: Sensitivity): RouteOutcome {
  if (confidence < T_REVIEW) return 'drop'
  const sLevel = SENSITIVITY_LEVELS[effectiveSensitivity]
  const autoThreshold = T_AUTO_BASE + sLevel * SENSITIVITY_HEADROOM
  return confidence >= autoThreshold ? 'auto_written' : 'pending'
}

/**
 * Pick the most-restrictive sensitivity from a set of candidates.
 * Order: `critical > high > medium > low`. Empty input falls back to `'low'`
 * — callers always supply at least the resource-level value.
 */
export function maxSensitivity(levels: readonly Sensitivity[]): Sensitivity {
  let best: Sensitivity = 'low'
  let bestIdx = 0
  for (const s of levels) {
    const idx = SENSITIVITY_ORDER.indexOf(s)
    if (idx > bestIdx) {
      best = s
      bestIdx = idx
    }
  }
  return best
}

/**
 * Minimal shape `effectiveSensitivity` reads from a proposal payload. Any
 * `ChangePayload` variant from `@vobase/core` satisfies this — only the
 * `'field_set'` branch carries a `fields` map, and the helper inspects it
 * lazily.
 */
export interface SensitivityPayload {
  kind: string
  fields?: Record<string, unknown>
}

/**
 * Resolve the effective sensitivity for a proposal payload by combining:
 *   1. resource-level sensitivity (always),
 *   2. per-scalar overrides for any top-level keys touched by a `field_set`,
 *   3. tenant-attribute sensitivities for any `attributes.<key>` paths
 *      (resolved by the optional resolver — only contacts wires one today).
 *
 * Markdown / JSON-patch payloads use only the resource-level value — there's
 * no field set to inspect.
 */
export async function effectiveSensitivity(args: {
  resourceSensitivity: Sensitivity
  sensitivityForFields?: Record<string, Sensitivity>
  payload: SensitivityPayload
  organizationId: string
  resolveAttributeSensitivities?: (organizationId: string, keys: readonly string[]) => Promise<Sensitivity[]>
}): Promise<Sensitivity> {
  const candidates: Sensitivity[] = [args.resourceSensitivity]
  if (args.payload.kind === 'field_set' && args.payload.fields) {
    const attrKeys: string[] = []
    for (const path of Object.keys(args.payload.fields)) {
      if (path.startsWith('attributes.')) {
        const key = path.slice('attributes.'.length)
        if (key) attrKeys.push(key)
        continue
      }
      const override = args.sensitivityForFields?.[path]
      if (override) candidates.push(override)
    }
    if (attrKeys.length > 0 && args.resolveAttributeSensitivities) {
      const attrLevels = await args.resolveAttributeSensitivities(args.organizationId, attrKeys)
      for (const s of attrLevels) candidates.push(s)
    }
  }
  return maxSensitivity(candidates)
}
