---
"@vobase/template": minor
"create-vobase": minor
---

Migrate the change-proposal registry to sensitivity-driven routing.

Replaces the binary `requiresApproval` flag with a typed `Sensitivity` enum (`'low' | 'medium' | 'high' | 'critical'`). `insertProposal` now combines the agent-supplied `confidence` with the resource's effective sensitivity (resource-level + per-scalar + per-attribute) via `effectiveSensitivity()` and routes to one of three outcomes:

- `'drop'` — confidence below `T_REVIEW` (the trivia gate)
- `'pending'` — middle band, lands on `/changes` for human review
- `'auto_written'` — confidence ≥ `T_AUTO_BASE + sLevel × HEADROOM`

The auto bar is **additive** (`T_AUTO_BASE + sLevel × HEADROOM`), not multiplicative — a `'critical'` resource raises the auto threshold but never silences high-confidence proposals into `'drop'`. Calibration knobs (`T_REVIEW=0.3`, `T_AUTO_BASE=0.7`, `SENSITIVITY_HEADROOM=0.3`) and the level→number map (`low=0.2`, `medium=0.4`, `high=0.7`, `critical=0.95`) read from env at module load.

`MaterializerRegistration` gains optional `sensitivity`, `sensitivityForFields`, and `resolveAttributeSensitivities` fields; the five existing module registrations migrate to the new shape with their previous defaults preserved.
