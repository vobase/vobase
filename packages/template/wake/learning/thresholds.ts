/**
 * Single source of truth for learning-loop calibration knobs.
 *
 * All numeric thresholds are env-overridable at process start. `learningThresholds`
 * is the static singleton read once at module load; `loadThresholds()` re-reads env
 * on each call (used by tests that mutate `process.env`).
 */

import { models } from '@modules/agents/lib/models'

/** Parse an env var as a number; return `fallback` when unset, empty, or non-finite. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface LearningThresholds {
  /** Fully-qualified `provider/model` id used for triage calls. Hardcoded to `models.gpt_mini`. */
  triageModel: string
  /** Confidence floor — proposals below this drop silently (review gate). */
  tReview: number
  /** Base auto-apply threshold — sensitivity 'low' starts here. */
  tAutoBase: number
  /** Each sensitivity level raises the auto bar by `sensitivityHeadroom × levelValue`. */
  sensitivityHeadroom: number
  /** Milliseconds to wait before enqueuing a triage job after a wake ends (debounce). */
  triageDebounceMs: number
  /** Days before an unconsumed learning candidate expires. */
  candidateExpiryDays: number
  /** Maximum candidates surfaced per side-load slice. */
  candidateSideLoadCap: number
}

/** Build a fresh `LearningThresholds` object by reading `process.env` at call time. */
export function loadThresholds(): LearningThresholds {
  return {
    triageModel: models.gpt_mini,
    tReview: envNumber('LEARN_T_REVIEW', 0.3),
    tAutoBase: envNumber('LEARN_T_AUTO_BASE', 0.7),
    sensitivityHeadroom: envNumber('LEARN_S_HEADROOM', 0.3),
    triageDebounceMs: envNumber('LEARN_DEBOUNCE_MS', 300_000),
    candidateExpiryDays: envNumber('LEARN_CANDIDATE_EXPIRY_DAYS', 7),
    candidateSideLoadCap: envNumber('LEARN_SIDELOAD_CAP', 5),
  }
}

/** Static singleton — read once at module load. Use `loadThresholds()` in tests. */
export const learningThresholds: LearningThresholds = loadThresholds()
