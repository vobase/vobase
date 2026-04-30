# @vobase/template

## 3.1.0

### Minor Changes

- [`26f886c`](https://github.com/vobase/vobase/commit/26f886c3567ac1a85b4294efb3ecf1bd6dc805bf) Thanks [@mdluo](https://github.com/mdluo)! - Three connected changes to the template's agent-facing surface:

  **Audience tier model.** Verbs are now tagged with `audience: 'admin' | 'staff' | 'contact'`, and the AGENTS.md `## Commands` block + in-bash `vobase --help` filter to what the wake's tier can see. The wake's tier is derived from `(lane, triggerKind)`:

  | `(lane, triggerKind)`                                                        | tier        |
  | ---------------------------------------------------------------------------- | ----------- |
  | `conversation + inbound_message`                                             | `'contact'` |
  | `conversation + supervisor / approval_resumed / scheduled_followup / manual` | `'staff'`   |
  | `standalone + operator_thread / heartbeat`                                   | `'staff'`   |
  | `vobase` CLI binary with admin API key (outside the harness)                 | `'admin'`   |

  Per-tier verb tagging applied across `messaging`, `team`, `drive`, `contacts`, `schedules`, `agents`, `system`. `team list` / `team get` / `conv reassign` / `drive propose` are `'contact'`-tier (every wake sees them); `messaging show` / `messaging close` / `agents show` are `'staff'`; everything else (`install`, `drive cat`, `system/*`, etc.) defaults to `'admin'` and is hidden from wakes. Filtering happens at the surface (visibility), not at dispatch — the bash sandbox doesn't hard-reject admin-tier verbs today.

  **`add_note` extended with `mentions`; `conv ask-staff` removed.** The `vobase conv ask-staff` verb and the standalone `ask_staff` tool are deleted. Asking staff a question is now a parameter on `add_note`: pass `mentions: [<userId or displayName>, ...]` and the tool resolves each token against the staff roster, prepends `@DisplayName` tokens to the body, and writes `staff:<userId>` mention strings — the existing post-commit fan-out in `messaging/service/notes` enqueues a supervisor wake per mentioned staff. `conversationId` is now optional on `add_note` and defaults to the current wake's conversation; required only on standalone-lane wakes that need to leave a note on a different conversation. The mentions array is bounded (`maxItems: 16`, per-token `maxLength: 64`) and dedups same-staff references so neither `staff:u1` mentions nor `@Alice` body prefixes are duplicated.

  **AGENTS.md preview HTTP route + lane-aware scratch.** New `GET /api/agents/definitions/:id/agents-md?lane=<>&triggerKind=<>&supervisorKind=<>` route renders the AGENTS.md preamble the agent would see for a given lane variant, used by the agent-edit page's lane switcher. The Plate renderer for the preview was rewired to `BasicBlocksPlugin` + `BasicMarksPlugin` and now omits `remarkMdx` (which silently truncated AGENTS.md at the first JSX-like token, e.g. `<id>` / `<2k` / `<file>`). Cross-org guards added on all four `/definitions/:id*` handlers so a session-authenticated user from one org can't preview / read / mutate / delete another org's agent. The new `WakeAgentsMdScratch` (`wake/agents-md-scratch.ts`) carries `(lane, triggerKind, supervisorKind)` to module-side AGENTS.md contributors, replacing prose-in-instructions: messaging now contributes lane-aware blocks for supervisor-coaching, ask-staff-answer, and standalone-no-customer wakes. `MERIGPT_INSTRUCTIONS` was trimmed in `modules/agents/seed.ts` to remove the sections now framework-emitted (lane rules, MEMORY.md routing, supervisor-wake handling).

  Documentation: the template's `CLAUDE.md` "Agent harness" section now documents the canonical context names (`AgentContributions<WakeContext>` boot-time, `WakeContext` per-wake, "agent harness" as the informal term for `wake/`), the audience-tier derivation table, and a "Adding agent surfaces in a new module" recipe (declare `tools` / `materializers` / `agentsMd` / `roHints` on `agent.ts`; register verbs through `ctx.cli.register(...)` with the right `audience`).

## 3.0.0

### Major Changes

- Promote template-v2 to the default `@vobase/template`. The prior template is archived to `legacy/template-v1/` (frozen, pinned to `@vobase/core@0.33.0`).

  Breaking changes:

  - Imperative composition replaces declarative `vobase.config.ts`. Tenants customize storage / auth / channels by editing the template source.
  - WhatsApp env vars renamed from `WA_*` to `META_WA_*`.
  - Knowledge-base, automation, and integrations modules removed (use v1 if needed). Mastra removed; agents now run on `@mariozechner/pi-agent-core`.
  - Default dev DB DSN reverted to `:5432 / vobase`.
  - `STORAGE_KEY` for theme localStorage renamed; users see system-default theme on first load after upgrade.

  See `packages/template/CLAUDE.md` for the new module set and conventions.
