/**
 * Opt-out kill-switch for *automatic* learning-triage producers.
 *
 * Automatic triage is ENABLED by default: every automatic signal source
 * (self-reflection on `agent_end`, coaching notes, staff takeover, proposal
 * rejection, coexistence echoes) checks this gate before enqueuing a
 * `learning:triage` job. The triage job handler and the candidate side-load
 * stay fully wired, so a manual trigger (per-conversation "learn from this
 * thread") can enqueue the same job and flow through unchanged regardless of
 * this switch.
 *
 * This is an opt-OUT kill-switch: set `LEARN_AUTO_TRIAGE` to a falsy value
 * (`0`/`false`/`no`/`off`) to disable the automatic producers globally — for
 * example while onboarding a number and back-filling synced history before the
 * agent should start auto-learning. Any other value (including unset) keeps
 * automatic triage on. Read at call time (not memoized) so tests and ops can
 * toggle it without a process restart — mirrors `loadThresholds()`.
 */

const FALSY = new Set(['0', 'false', 'no', 'off'])

/** True when automatic triage producers are allowed to enqueue. Default: true. */
export function isAutoTriageEnabled(): boolean {
  const raw = process.env.LEARN_AUTO_TRIAGE
  return raw ? !FALSY.has(raw.trim().toLowerCase()) : true
}
