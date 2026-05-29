---
"@vobase/template": minor
---

# Lead routing + conversation ownership, scriptable agent ops, and a blocking wake test verb

A batch of operator- and agent-facing capabilities: a staff-attribute–driven lead-routing engine with conversation ownership, three CLI verbs for managing an agent's skills without a redeploy, a one-call end-to-end wake test verb, and an explicit-save markdown editor.

## Attribute-driven lead routing + conversation ownership

Leads now route to staff by **profile attributes** rather than a hardcoded picker, and conversations carry an **owner** (staff-in-charge) distinct from the assignee (whoever currently replies).

Routing resolves in three tiers, with a least-recently-assigned tiebreak so volume spreads evenly:

1. **Exclusive** rule — a keyword bound to a single rep wins outright.
2. **Pool keyword** — a keyword maps to a pool; the least-recently-assigned member of that pool takes it.
3. **Corporate-lead fallback** — when nothing matches, the lead falls to staff carrying the relevant `team_lead` attribute.

Keyword matching is whole-word and longest-match-wins, so a more specific rule beats a broader one regardless of declaration order.

New schema (a DB push/migrate is required when upgrading a scaffold):

| Table / column | Purpose |
| --- | --- |
| `staff_profiles.attributes` (jsonb) | Per-staff booleans/values (`corporate_team`, `private_team`, `team_lead`, …) that drive routing membership |
| `staff_attribute_definitions` | Tenant-defined attribute catalog (key, label, type, options, show-in-table) |
| `routing_rules` | `exclusive` / `pool_keyword` / `corporate_lead` rules (keyword, pool, repUserId, priority) |
| `team_descriptions.lead_user_id` | Per-team lead |
| `conversations.owner_user_id` + `owner_assigned_at` (+ `idx_conv_owner`) | Conversation owner and the timestamp the round-robin reads for least-recently-assigned |

What ships with it:

- **`lead-routing` service** — the resolver above, reading staff attributes and `routing_rules`.
- **`route-lead` agent tool** — lets the agent route a lead from inside a wake.
- **`team routing` CLI verb** — `list` / `set` / `rm` / `simulate` / `check`. `simulate` dry-runs a `(company, industry)` against the live rule set; `check` validates that the fallback attributes exist so routing can't dead-end.
- **`team set-attribute` CLI verb** — set a staff attribute (`--user --key --value`) without touching the DB directly.
- **`conv set-owner` CLI verb** — set/clear a conversation's owner (`--to=user:<id>|unassigned`); staff-tier. The agent keeps replying regardless of owner.
- **`/team/routing` admin UI** — view and edit routing rules; the team pages surface membership, priority, and owner/responder badges.

## Scriptable agent skill management

Three admin verbs make an agent's skill set fully scriptable — no redeploy, no DB surgery:

| Verb | Flags | Effect |
| --- | --- | --- |
| `agents set-allowlist` | `--id --skills=<csv>` | Replace `skillAllowlist` wholesale (empty clears it) |
| `agents set-skill` | `--id --name --body` (+ `--description --tags`) | Upsert a `learned_skills` row; bumps `version` |
| `agents remove-skill` | `--id --name` | Delete a `learned_skills` row; idempotent |

Note the nuance `remove-skill` exists to handle: **trimming the allowlist alone does not hide a skill** — the drive overlay mounts a `SKILL.md` for every `learned_skills` row regardless of the allowlist, so making an obsolete skill disappear requires deleting the row. Backed by new `upsertLearnedSkill` / `removeLearnedSkill` service methods and a `skillAllowlist` field on `UpdateAgentInput`.

## `agents debug wake-sync` — one-call end-to-end wake test

Injects a simulated web inbound through the generic channel `dispatchInbound` (faithful routing: assignment, 24h window, debounce, wake enqueue) and **blocks until the resulting wake reaches a terminal `agent_end`**, returning the wake summary plus per-tool-call detail in a single call. It collapses the manual "send → poll messages → cross-check notes" loop operators used for behavior testing.

```
vobase agents debug wake-sync --text="..." [--from=<stable-key>] [--assign=agent:<id>] [--timeout=120]
```

- Reuse `--from` across calls to drive a multi-turn conversation on the same contact (each call carries a fresh `externalMessageId`, so it always wakes).
- Returns `status: 'settled' | 'timeout' | 'no_wake'`; `endReason: 'blocked'` means the wake paused on an approval (card / file / book-slot) rather than producing a reply.
- Admin-tier; never exposed to a wake's bash sandbox.

Backed by a `waitForWake` reader on the debug-readers service — a watermark-scoped poll of `harness.conversation_events` that locks onto the first wake started after the trigger and ignores stale ones.

## Drive markdown editor: explicit save

The drive-document and agent-instruction editors no longer autosave on every keystroke. They now use an explicit **Save** button and compute the dirty flag against a round-tripped baseline (serialized on mount, refreshed after each save), so a freshly opened, untouched document no longer reports itself dirty.

## `vobase-cli-ops` skill refresh

The bundled `vobase-cli-ops` skill's verb catalog now documents the verbs above (skill management, `team set-attribute`, `team routing`, `conv set-owner`, `agents debug wake-sync`), corrects the text-verb flag note (`--body` / `--body-from`, not `--file`), and ships a tighter trigger description.

## Test coverage

- `team/service/lead-routing.test.ts` + `lead-routing.integration.test.ts` — routing resolution and tiebreak.
- `tests/e2e/wake-sync-wait.e2e.test.ts` — the `waitForWake` status state machine (settled / timeout / no_wake / watermark filtering / block-then-settle), 5 cases against real Postgres.
- Ownership and routing wiring updated across the messaging/team service and e2e suites.
