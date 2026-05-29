---
name: vobase-cli-ops
description: |
  Operate a live vobase tenant from the terminal with the `vobase` CLI — debug and improve agent behavior, manage an agent's instructions / working memory / skills / allowlist, mutate drive docs, contacts, and conversations, set staff attributes, simulate lead routing, and run end-to-end agent tests (including the blocking `agents debug wake-sync`). Use whenever the user wants to debug or improve the agent, test what it says, change its instructions or knowledge, manage skills, reassign or set the owner of a conversation, or run `vobase` commands (`auth login`, `drive propose`, `agents …`, `conv …`, `team …`, `routing …`) against a tenant.
---

# vobase CLI ops — debugging and improving a live tenant

The vobase CLI is the operator's seam for a running tenant. It walks the catalog endpoint, dispatches verbs over HTTP-RPC, and changes real tenant state. Most "improve the agent" workflows are CLI-driven: the agent's behavior reads from drive content + memory + contact state, all of which the CLI can mutate.

## Why this exists

When the user asks "how do I make the agent cite our new SLA?" or "the agent should know about beta-tester discounts" or "Marcus's contact info is wrong", the answer is almost never "edit source code and redeploy." It's a CLI mutation. This skill captures the verb-by-verb mechanics, flag names, path conventions, approval routing, and end-to-end agent-comparison patterns that took a real session to discover.

## Setup — pick a tenant + authenticate

Each `<name>.json` file is one tenant. Switch via `--config <name>` or `VOBASE_CONFIG=<name>`. The catalog cache (`<name>.cache.json`) lives next to the config it was loaded from (auto-invalidates on etag drift; force with `--refresh`).

### Where configs live: local-first hybrid lookup

Same shape as `git`/`gh`/`kubectl`. The CLI walks for the config in this order:

1. `./.vobase/<name>.json` walking up from `cwd`, stopping at the **repo root** (a `.git` sibling) or `$HOME` — whichever comes first. **Closest wins.**
2. `~/.vobase/<name>.json` — fallback for the single-tenant operator who doesn't want per-checkout configs.

Use **`vobase auth login --local`** to write to `./.vobase/<name>.json` instead of the home tier. This is the right move for an agency operator with N client repos: `cd client-acme && vobase ...` automatically hits ACME's tenant; `cd client-globex && vobase ...` hits Globex. No `--config` flags needed at the call site.

> **Version floor.** `--local` requires `@vobase/cli >= 0.42.x`. Older binaries silently accept the flag (commander.js passes unknown options through) and still write to `~/.vobase/`. Check with `bun pm view @vobase/cli version` vs. `head -1 $(readlink -f $(which vobase))`'s package; upgrade with `bun install -g @vobase/cli@latest`. After the resolved-path logging change (post-0.42.x), `auth login` prints `Config written to <path> (local-tier: in-repo)` so you can see what actually happened.

Both `.gitignore` files in the canonical template ignore `.vobase/` so an accidental commit can't leak the API key.

### Three auth paths, fastest first

**1. Headless `--token` (when you already have an API key):**
```bash
vobase auth login --url=https://tenant.vobase.app --token=vbt_<key>
vobase auth whoami     # confirm
```

**2. Browser device-grant (mirrors what humans do):**
```bash
vobase auth login --url=https://tenant.vobase.app
# opens browser → confirm in UI → CLI polls and saves the key
```

**3. Programmatic (for E2E scripts) — dev-login + cli-grant flow:**
```bash
# (dev-only; bypasses OTP. Available locally and in dev deployments.)
# Pick the email by which TIER you need:
#   alice@meridian.test → owner role → admin tier (sees admin verbs incl. `agents debug *`)
#   alice@meridian.dev  → member role → staff tier (sees staff + contact verbs only)
# The seed creates both. For agent-execution debugging you need the .test owner.
DEV=$(curl -s -i -X POST "$BASE/api/auth/dev-login" \
  -H "Content-Type: application/json" -d '{"email":"alice@meridian.test"}')
COOKIE=$(echo "$DEV" | grep -i '^set-cookie:' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

CODE=$(curl -s -X POST "$BASE/api/auth/cli-grant" | jq -r .code)

curl -s -X POST "$BASE/api/auth/cli-grant/confirm" \
  -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"name\":\"e2e\"}"

KEY=$(curl -s "$BASE/api/auth/cli-grant/poll?code=$CODE" | jq -r .apiKey)
# Save to ~/.vobase/<name>.json with chmod 0600 — see references/programmatic-auth.sh
```

### Auth troubleshooting

- **`vobase auth login` opens a 404 page at `/auth/cli-grant?code=...`.** The tenant's frontend is missing the `/_auth/auth/cli-grant` route. The backend (`auth/cli-grant.ts`) mints the URL but the page is a separate frontend route in `src/shell/auth/cli-grant.tsx`. Canonical template ships it from `@vobase/template` post-this-week; old tenants need to backport `src/shell/auth/cli-grant.tsx` + register it in `src/routes.ts` and redeploy. Workaround until the deploy lands: do the device-grant by hand — start grant via `POST /api/auth/cli-grant`, POST the code to `/api/auth/cli-grant/confirm` with a session cookie copied from the prod web UI's DevTools, poll `/api/auth/cli-grant/poll?code=...`, write the resulting `apiKey` to `./.vobase/<name>.json`.
- **`vobase --config <name> auth whoami` returns `Authentication failed` after a DB reset.** The local config's API key is now stale. Re-run `vobase auth login` (browser device-grant) or `--token=<new-key>`.
- **`--local` was passed but the config still landed in `~/.vobase/`.** Installed CLI version is below 0.42.x — commander.js silently accepts the unknown flag and the write path is unchanged. Upgrade: `bun install -g @vobase/cli@latest`. Verify: the new `Config written to <path> (local-tier: in-repo)` log line confirms the resolved tier.

## Discovering verbs

The catalog is **filtered by audience tier** (`contact` < `staff` < `admin`). What you see depends on your role:

```bash
vobase --help                 # group-level overview
vobase --refresh              # force re-fetch
vobase <group> --help         # detail for one group (e.g. `vobase team --help`)
```

Anonymous calls to `/api/cli/verbs` are blocked at 401. Authenticated members see contact + staff verbs. Admin keys see all verbs including `system`, `install`, `drive cat`.

## The verb catalog (verified end-to-end)

The verbs below are the canonical-template surface used for operating a live tenant. **Flag names are the most error-prone part of CLI use** — copy from the table verbatim. Audience tier is shown in the last column (only what your role can see in the catalog).

### Staff-tier (visible to member + owner + admin)

| Verb | Required flags | Purpose | Read/Write |
|---|---|---|---|
| `team list` | — | Staff directory | read |
| `team get` | `--user=<userId>` | Single staff member | read |
| `agents show` | `--id=<agentId>` | Agent definition (instructions, model, working_memory) | read |
| `messaging show` | `--id=<conversationId>` | Conversation row + activity timeline (assignee/status/change.* events). **Does NOT include message bodies — use `messaging messages` for those.** | read |
| `messaging messages` | `--id=<conversationId>` (`--limit`, `--since` opt.) | Customer/agent/staff messages with full bodies | read |
| `messaging notes` | `--id=<conversationId>` | Renders `INTERNAL-NOTES.md` byte-identically to what the agent's bash sandbox sees during a wake | read |
| `messaging close` | `--id=<conversationId>` (`--reason` optional) | Resolve a conversation | write |
| `conv reassign` | `--conversationId=<id>` `--to=user:<id>\|agent:<id>\|unassigned` | Hand off the **assignee** (who replies) | write |
| `conv set-owner` | `--to=user:<id>\|unassigned` (`--conversationId=<id>` for HTTP-RPC) | Set the conversation **owner** (staff-in-charge of the lead/ticket). Distinct from assignee — the agent keeps replying. Pass `unassigned` (or `none`) to clear. | write |
| `drive search` | `--query=<text>` `--scope=organization` | Hybrid search across drive | read |
| `drive propose` | `--path=/<scope-relative>` `--body=<content>` `--rationale=...` `--confidence=0.95` | Propose a markdown_patch to a drive file. **Creates the file if it doesn't exist** — the materializer picks create-vs-patch automatically. This is the primary way to seed/replace any markdown file in `/drive/`. | write (proposal) |
| `contacts propose-change` | `--id=<contactId>` `--field=<name>` `--to=<value>` `--rationale=...` `--confidence=0.95` | Propose a contact field update | write (proposal) |

### Admin-tier (owner + admin only — agent-execution debug surface)

These are how you debug a live tenant from the CLI alone — no `psql` access required, safe for remote deployments. Walk-up order is `wakes → timeline → llm-io` (broad-to-narrow).

| Verb | Required flags | Purpose |
|---|---|---|
| `agents list` | — | Roster of agent definitions |
| `agents inspect` | `--id=<agentId>` | Instructions + working-memory tail (8KB) + skill allowlist + model |
| `agents reload` | `--id=<agentId>` | Confirm next wake will see latest definition |
| `agents set-instructions` | `--id=<agentId>` `--body=<text>` (or `--body-from=<localPath>`) | Replace the agent's instructions (system-prompt preamble; frozen once per wake). Wholesale overwrite. |
| `agents set-working-memory` | `--id=<agentId>` `--body=<text>` (or `--body-from=<localPath>`) | Replace the agent's working memory (`/agents/<id>/MEMORY.md`). Wholesale overwrite, not an append. |
| `agents set-allowlist` | `--id=<agentId>` `--skills=<csv>` | Replace the agent's `skill_allowlist` wholesale. `--skills=bash,vobase,foo`; `--skills=` (empty) clears it. Only flips the visibility gate — skill *bodies* live in `learned_skills`. |
| `agents set-skill` | `--id=<agentId>` `--name=<slug>` `--body=<text>` (or `--body-from=<localPath>`) [`--description=<text>`] [`--tags=<csv>`] | Upsert a learned-skill `SKILL.md` body, keyed on `(org, agent, name)`. Re-running the same `--name` updates in place and bumps `version`. The body materializes at `/agents/<id>/skills/<name>/SKILL.md` **only when `name` is also in the allowlist** — pair with `set-allowlist`. `--name` is slug-case (`^[a-z0-9][a-z0-9-]*$`). |
| `agents remove-skill` | `--id=<agentId>` `--name=<slug>` | Delete a learned-skill *row*. Idempotent (`deleted: 0` if absent). **Trimming the allowlist alone does NOT hide a skill** — the drive overlay surfaces every `learned_skills` row regardless of allowlist, so the row itself must go. This is the only verb that truly disappears an obsolete skill. |
| `agents debug wakes` | `--conversationId=<id>` (`--limit=20`, `--since` opt.) | Wake-by-wake summary: trigger, started_at, turns, tool_calls, cost, **systemHash** (drift across wakes = frozen-snapshot violation), endReason. First place to look for "did the agent even wake?" / "where did the cost go?" |
| `agents debug timeline` | `--wakeId=<id>` (`--full` opt.) | Per-wake event timeline (`agent_start`, `tool_dispatch_*`, `tool_execution_*`, `llm_call`, `agent_end`). Reveals "did the agent skip the file read?" / "is it looping?" |
| `agents debug llm-io` | `--conversationId=<id>` OR `--wakeId=<id>` (`--seq=N:M`, `--role`, `--tool`, `--limit=30`, `--full` opt.) | The LLM I/O log (`harness.messages`): user cues, assistant tool calls with arguments, tool results, model + token + cost per row. The killer verb — shows what the LLM saw and decided. |
| `agents debug wake-sync` | `--text="..."` (`--from=<stable-key>`, `--channelInstanceId=<id>`, `--assign=agent:<id>`, `--timeout=120`, `--pollMs=1500`, `--profile` opt.) | Inject a simulated web inbound and **block until the wake settles** (`agent_end`), returning the wake summary + tool calls in one call. Replaces the manual send→poll-messages→poll-notes loop. See the end-to-end section below. |
| `team set-attribute` | `--user=<userId>` `--key=<attrKey>` `--value=<v>` | Set one value on a staff profile's `attributes` JSONB (merge — only the passed key is touched). `--value` is coerced to the type the attribute *definition* declares; booleans accept `true/false/yes/no/1/0`, `null` clears. Unknown `--key` is rejected with the list of known keys. |
| `routing list` | — | List every lead-routing rule (exclusive accounts, keyword pools, pool members). Read-only. |
| `routing set` | `--kind=<exclusive\|pool_keyword\|pool_member>` (`--keyword`, `--pool`, `--rep=user:<id>`, `--priority` per kind) | Create/replace a routing rule. `exclusive` needs `--keyword`+`--rep`; `pool_keyword` needs `--keyword`+`--pool`; `pool_member` needs `--pool`+`--rep`. `--rep` is resolved against the roster so typos are rejected. |
| `routing rm` | `--id=<ruleId>` | Delete a routing rule by id (from `routing list`). |
| `routing simulate` | `--type=<corporate\|private>` (`--company`, `--industry` opt.) | Dry-run the lead matcher for a hypothetical inquiry — shows who it would route to and why, without creating anything. Read-only. |
| `routing check` | — | Validate routing config: rules (rep resolution, orphan pools) plus the attribute-driven team-lead fallback (`corporate_team` / `private_team` / `team_lead`). Reports issues + warnings. Read-only. |
| `drive upload` | `--file=<local-path>` [`--scope=organization|contact|staff|agent`] [`--scopeId=<id>`] [`--basePath=/`] | Upload a local file's bytes into the drive. `--file` reads from the **operator's** filesystem (the CLI base64-encodes the bytes and ships them over the wire), so this works against remote tenants. Use for PDFs, images, office docs, or any binary the agent should be able to `request_caption` on. For markdown / policy text that should route through the proposal-review flow, prefer `drive propose --body=...` instead. (`--path=<server-path>` still works for the agent's in-process bash sandbox.) | write |

### Critical flag-name gotchas

- `team get` uses `--user`, NOT `--userId`.
- `messaging show` / `messaging messages` / `messaging notes` / `messaging close` use `--id`, NOT `--conversationId`.
- `conv reassign` uses `--conversationId`, NOT `--id` (yes, the inverse of messaging — easy to swap).
- `agents debug wakes` uses `--conversationId`, NOT `--id`.
- `agents debug timeline` uses `--wakeId` (the 12-char nanoid from `agents debug wakes`).
- `agents debug llm-io` accepts EITHER `--conversationId` OR `--wakeId`; `--wakeId` auto-derives the conversation and narrows the seq window to that wake's `agent_start..agent_end` time range.
- `contacts propose-change` uses `--field` + `--to`, NOT `--field=` + `--value=`.
- `drive propose` uses `--body`, NOT `--content`.
- `agents set-instructions` / `set-working-memory` / `set-skill` take `--body=<text>`. To load text from a file use **`--body-from=<localPath>`**, NOT `--file`. The CLI resolver maps `--body-from` → `body` (reads the local file as UTF-8 text); `--file` is reserved for **binary** uploads (`drive upload`) where it base64-encodes bytes into `fileBytes`. Passing `--file` to a text verb won't populate `--body` and the verb errors on the missing field.
- `agents set-allowlist` uses `--skills=<csv>` (comma-separated); `--skills=` with no value *clears* the allowlist (it isn't a "missing flag" error).
- `agents set-skill` / `remove-skill` use `--name=<slug>` (lowercase/digits/hyphens) — NOT `--skill`.
- `agents debug wake-sync` uses `--text`, and reuses `--from=<stable-key>` to continue the same conversation across calls (omit `--from` ⇒ fresh conversation each call).
- `team set-attribute` uses `--user` + `--key` + `--value` (NOT `--userId`). `conv set-owner` uses `--to=user:<id>` (and `--conversationId` over HTTP-RPC), NOT `--id`.
- `drive upload` uses `--file=<local-path>` (read on the operator's machine, base64'd over the wire). The legacy `--path=<server-path>` form is still accepted but only useful for the agent's in-process bash sandbox — never use it against a remote tenant, the path would resolve on the container, not your laptop.

Always run the verb with no args first to see the validation error — it returns the exact missing/wrong field path under `errorCode: "invalid_input"`.

## Path conventions — the most subtle thing in vobase

Drive paths in the database are **scope-relative**: `/pricing.md`, `/BUSINESS.md`, `/policies/refunds.md`. The agent's bash sandbox sees them mounted at `/drive/<path>`: `/drive/pricing.md`, `/drive/BUSINESS.md`.

When you propose or upload, **use the scope-relative path**:

- ✅ `vobase drive propose --path=/pricing.md ...`
- ❌ `vobase drive propose --path=/drive/pricing.md ...` (this lands at `/drive/drive/pricing.md` — invisible to the agent)

The agent's `MeriGPT`-style instructions reference `/drive/<file>.md` because that's the bash-view path. The CLI proposal should use the DB-view path.

## Output modes (`--json`, `--no-json`, auto-JSON)

Precedence: `--json` wins over `--no-json` wins over auto-JSON-on-non-TTY.

- TTY + no flags → human table (per the verb's `formatHint`)
- pipe / non-TTY + no flags → JSON (auto)
- `--json` → JSON always
- `--no-json` → table even when piped (overrides auto)

Some verbs have `formatHint: 'json'` and emit JSON regardless — `--no-json` can't flip them. That's correct (the verb's response is JSON-only).

## Approval routing — auto_written vs pending

`drive propose` and `contacts propose-change` go through the changes module. The result `status` field tells you what happened:

- `auto_written` / `auto_applied` — the change is live now. High confidence + low sensitivity passed both gates.
- `pending` — high-sensitivity field touched. Queued for staff review.
- `dropped` — sub-threshold confidence. Filtered out by sensitivity routing.

To force-approve a pending proposal in development (requires session, not Bearer):

```bash
COOKIE=$(curl -s -i -X POST "$BASE/api/auth/dev-login" \
  -H "Content-Type: application/json" -d '{"email":"alice@meridian.dev"}' \
  | grep -i '^set-cookie:' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

curl -s -X POST "$BASE/api/changes/proposals/$PROPOSAL_ID/decide" \
  -H "Content-Type: application/json" -H "Cookie: $COOKIE" \
  -d '{"decision":"approved","decidedByUserId":"usr0alice0","note":"e2e"}'
```

`decision` is `"approved"` or `"rejected"` — not `"approve"`. The route requires session middleware, so a Bearer API key alone won't work; you need a cookie from `dev-login`.

## How to actually improve the agent's behavior

The agent reads:
1. Its `agentDefinitions.instructions` (system prompt) — system-level rules
2. Its `agentDefinitions.workingMemory` (mounted at `/agents/<id>/MEMORY.md`) — persistent self-knowledge
3. `/drive/**` files via bash `cat` — organization knowledge
4. The contact's record + memory file (`/contacts/<id>/MEMORY.md`)
5. Skill files at `/agents/<id>/skills/*.md`

To make the agent cite a new fact:

| Goal | Mutation |
|---|---|
| Agent should reference a new policy / pricing / SLA | `drive propose --path=/<existing-doc>.md --body=<original + new section>` to a file the instructions already tell it to `cat` (typically `/BUSINESS.md` or `/pricing.md`). Adding a brand-new file the instructions don't reference is **invisible to the agent**. |
| Agent should be able to read a binary asset (PDF, image, office doc) | `drive upload --file=<local-path> [--scope=...] [--basePath=...]` — bytes go to storage, the extraction + caption pipeline runs, and the agent's `request_caption` tool works. Use this for any non-text file. Markdown text should go through `drive propose --body=...` instead. |
| Agent should remember a customer fact | `contacts propose-change --id=<contactId> --field=<attribute> --to=<value>` — the agent's wake reads contact state automatically. |
| Agent should change tone / behavior universally | `vobase agents set-instructions --id=<agentId> --body=<text>` (admin-tier). Load from a file with `--body-from=<localPath>` (NOT `--file`). Wholesale overwrite of the instructions column; the next wake re-reads it (definitions aren't cached). |
| Agent should remember a session-level lesson | `vobase agents set-working-memory --id=<agentId> --body=<text>` (admin-tier; `--body-from=<localPath>` to load from a file). Wholesale replace, not an append — for incremental learning let the agent self-update via the `remember` tool from inside a wake. |
| Agent should gain (or lose) a learned skill | `vobase agents set-skill --id=<agentId> --name=<slug> --body=<text>` to upsert the `SKILL.md` body, then `vobase agents set-allowlist --id=<agentId> --skills=<csv-including-the-new-name>` so the overlay surfaces it. To **remove** a skill, `vobase agents remove-skill --id=<agentId> --name=<slug>` — trimming the allowlist alone leaves the row (and its `/skills/<name>/SKILL.md`) visible. |

**The "add a new file" trap.** If you upload `/drive/foo.md` but the agent's instructions don't tell it to `cat /drive/foo.md`, it won't read the file. Always update an existing file the agent already references.

> **An agent with empty `instructions` reads nothing.** Newly-seeded agents (from the canonical template) ship with `instructions: ""` and `working_memory: ""` — `vobase agents inspect --id=<id>` shows this immediately. With no system prompt, the agent's only behavioral anchors are the wake-cue, module-supplied AGENTS.md fragments, and whatever it discovers via `bash`/`vobase` verbs at wake time. **Proposing `/drive/BUSINESS.md` against such an agent is dead weight** — the file lands in the drive but nothing tells the agent to `cat` it. Set instructions FIRST (with explicit `cat /drive/<file>` calls), then propose drive content. Inspect before assuming the agent has a system prompt.

## Test agent behavior end-to-end

### Fast path — `agents debug wake-sync` (one blocking call)

For "what does the agent actually say/do when a customer sends X?", `agents debug wake-sync` is the one-call replacement for the whole send→poll-`messaging messages`→cross-check-`messaging notes` loop. It injects a simulated **web** inbound through the same `dispatchInbound` path a real webhook uses (so assignment, the 24h window, and the wake enqueue all behave identically — a faithful simulation, not a shortcut), then **blocks until the wake reaches `agent_end`** and returns the wake summary + the tool calls it made.

```bash
# Single turn — fresh conversation each call (no --from)
vobase agents debug wake-sync --text="Are you GST registered?"

# Multi-turn — reuse the SAME --from to stay on one conversation/contact
vobase agents debug wake-sync --from=test-cust-1 --text="Hi, I have a question about pricing"
vobase agents debug wake-sync --from=test-cust-1 --text="and what about weekend delivery?"
```

- `--from=<stable-key>` is the web external key. Omit it and each call mints a fresh contact + conversation; reuse it and the inbound dedups onto the same web contact + conversation (each call still carries a fresh `externalMessageId`, so it always wakes).
- `--assign=agent:<id>` overrides the routing target; without it the verb uses the web instance's configured `defaultAssignee`. If neither resolves, the conversation lands unassigned, no agent wakes, and the verb returns `status: 'no_wake'`.
- `--channelInstanceId=<id>` is only needed when the org has more than one web instance (the verb errors with the list otherwise).
- `--timeout=<seconds>` (default 120, max 300) and `--pollMs` (default 1500) bound the wait. A real LLM wake is 30-90s.
- **`endReason: 'blocked'` means the wake paused on an approval** (a `send_card` / `send_file` / `book_slot` proposal) — it ended without a customer-visible reply. Inspect the pending proposal rather than waiting for text.
- One wake per call: a customer follow-up arriving mid-wake drains into the *same* wake via the SteerQueue; staff-note / approval-resumed re-wakes are separate `wake_id`s this verb won't observe (drive those with a real staff note + `agents debug wakes`).

After it returns, drill into the wake it reports with `agents debug timeline --wakeId=<id>` / `agents debug llm-io --wakeId=<id>` exactly as below.

### before/after pattern (manual loop)

When you need to script a before/after comparison around a mutation (or you're not on a `wake-sync`-capable binary), the manual loop still works:

```ts
// 1. Send inbound BEFORE the mutation
const before = await sendInbound('test-customer-1', 'How does X work?')
const replyBefore = await waitForAgentReply(before.conversationId)

// 2. Mutate via CLI
spawnSync('bun', ['/path/to/cli/bin/vobase.ts', '--json', 'drive', 'propose',
  '--path=/pricing.md', `--body=${updatedContent}`,
  '--rationale=...', '--confidence=0.95'], { env: { ...process.env, VOBASE_CONFIG: 'smoke' } })

// 3. Decide pending proposals (cookie from dev-login)
await fetch(`${BASE}/api/changes/proposals/${id}/decide`, { ... })

// 4. Send inbound AFTER (fresh contact to avoid memory contamination)
const after = await sendInbound('test-customer-2', 'How does X work?')
const replyAfter = await waitForAgentReply(after.conversationId)

// 5. Compare
console.log({ before: replyBefore, after: replyAfter })
```

See `references/before-after-template.ts` for a complete, runnable scaffold.

### Sending an inbound message (web channel)

```ts
import { createHmac } from 'node:crypto'
const body = JSON.stringify({
  channelType: 'web', organizationId: ORG_ID,
  from: `web-test-${Date.now()}`, profileName: 'Test',
  content: 'Customer message text',
  contentType: 'text',
  externalMessageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
  timestamp: Date.now(),
})
const sig = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
const res = await fetch(`${BASE}/api/channels/adapters/web/inbound`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-channel-instance-id': CHANNEL_INSTANCE,   // typically 'chi00web00' in seed
    'x-hub-signature-256': sig,
  },
  body,
})
const { conversationId } = await res.json()
```

`WEBHOOK_SECRET` defaults to `'dev-secret'` in dev (override via `CHANNEL_WEB_WEBHOOK_SECRET`). Each inbound creates a contact + conversation if `from` is new.

**Bun + `.env` HMAC footgun.** Bun auto-loads `packages/template/.env`. The shipped `.env` keeps `CHANNEL_WEB_WEBHOOK_SECRET` commented (so dev falls back to `'dev-secret'`), but if anyone uncomments it as `CHANNEL_WEB_WEBHOOK_SECRET=` (empty), every Bun script that uses `process.env.CHANNEL_WEB_WEBHOOK_SECRET ?? 'dev-secret'` will sign with `""` while the server (which uses an `if (configured)` truthy check) signs with `'dev-secret'`. Result: silent 401 on every inbound. **Use `||` not `??`** in scripts, or just test it once with a known-good `curl` to compare. The shared smoke helper at `tests/helpers/changes-smoke.ts` already does this correctly with `||`.

### Polling for the agent reply

The `messaging.messages` table is the customer-facing surface. Poll for `role='agent'` rows:

```ts
const rows = await sql<{ content: any }[]>`
  SELECT content FROM messaging.messages
  WHERE conversation_id = ${conversationId} AND role = 'agent'
  ORDER BY created_at ASC`
```

Reply `content` is JSONB — `{ text: '...' }` for plain replies, `{ card: { children: [...] } }` for `send_card` outputs. Helper:

```ts
function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (content?.text) return content.text
  if (content?.card?.children) {
    return content.card.children
      .map((c: any) => c.type === 'text' ? c.content
        : c.type === 'actions' ? `[${c.children?.map((b:any)=>b.label).join(' | ')}]` : '')
      .filter(Boolean).join('\n')
  }
  return JSON.stringify(content).slice(0, 400)
}
```

Real LLM wakes take 30-90 seconds. Poll on a 1.5-second interval; cap timeout at 90s.

## DB cheat sheet (last resort — prefer verbs first)

**Don't reach for SQL on a remote deployment.** The CLI has admin-tier coverage for every common debug question (see "agent-execution debug surface" above). Use `psql` only for cross-cutting joins or schemas no verb exposes (e.g. `pending_approvals`, `change_proposals`).

For ad-hoc local inspection use Drizzle Studio: `cd packages/template && bun run db:studio`. For automation:

```sql
-- Connect: postgres://vobase:vobase@localhost:5432/vobase

-- Conversations  →  prefer `vobase messaging list` / `messaging show`
SELECT id, status, assignee, contact_id FROM messaging.conversations LIMIT 10;
-- assignee: 'user:<id>' or 'agent:<id>' or 'unassigned'
-- status: 'active' | 'awaiting_approval' | 'resolved' | 'snoozed'

-- Messages  →  prefer `vobase messaging messages --id=<convId>`
SELECT id, role, content->>'text' AS text FROM messaging.messages
WHERE conversation_id = $1 ORDER BY created_at;

-- Internal notes  →  prefer `vobase messaging notes --id=<convId>`
SELECT body, mentions FROM messaging.internal_notes WHERE conversation_id = $1;

-- Drive files (content lives in extracted_text)  →  prefer `vobase drive ls` + `drive cat`
SELECT id, path, length(extracted_text) FROM drive.files WHERE scope='organization';

-- Agents  →  prefer `vobase agents list` / `agents inspect --id=<id>`
SELECT id, name, working_memory FROM agents.agent_definitions;

-- Contacts (no `contacts list` verb — contacts are PII-sensitive; admin-only via DB)
SELECT id, display_name, attributes FROM contacts.contacts;

-- Pending proposals (no verb yet; queue admin via DB)
SELECT id, resource_module, resource_type, resource_id, status, payload
FROM changes.change_proposals WHERE status='pending';

-- Wake journal  →  prefer `vobase agents debug wakes` / `debug timeline`
SELECT wake_id, type, ts, payload FROM harness.conversation_events
WHERE conversation_id = $1 ORDER BY ts;

-- LLM I/O log  →  prefer `vobase agents debug llm-io --conversationId=<id>`
SELECT m.seq, m.payload FROM harness.messages m
JOIN harness.threads t ON t.id = m.thread_id
WHERE t.conversation_id = $1 ORDER BY m.seq;
```

## Path-resolution trap, recap

| You write | Stored as | Visible to agent at |
|---|---|---|
| `--path=/pricing.md` | `/pricing.md` | `/drive/pricing.md` ✓ |
| `--path=/drive/pricing.md` | `/drive/pricing.md` | `/drive/drive/pricing.md` ✗ (unreachable) |
| `drive upload --file=./x.pdf --basePath=/policies/` | `/policies/x.pdf` | `/drive/policies/x.pdf` ✓ |

## Audience tier truth table

| Caller | Sees | How |
|---|---|---|
| anonymous (no Bearer) | nothing — 401 from middleware | api-key middleware blocks first |
| member role with API key | `audience: 'contact'` + `'staff'` verbs | `getAudience()` returns `'staff'` |
| **owner OR admin** role with API key | all verbs including admin-only (`agents debug *`, `drive cat`, `system *`, `install`) | `getAudience()` returns `'admin'` for both roles |
| agent's bash sandbox | filtered by wake's `audienceTier` (typically `'contact'` for inbound, `'staff'` for staff-note wakes) | `isVerbVisible(verb.audience, wake.audienceTier)` |

**Both `owner` and `admin` get the admin tier.** better-auth's role hierarchy is `owner > admin > member`; the catalog treats both top roles equivalently. (Pre-fix, `owner` was silently filtered down to `staff` and couldn't see admin verbs — a regression caught by dogfooding the debug surface itself.)

## When a CLI mutation didn't change the agent

Diagnosis order — all CLI-driven, no `psql` required for steps 1–5:

1. **Did the proposal actually apply?** Check `status` field of the propose response. `auto_written` = applied; `pending` = needs decide; `dropped` = below threshold (raise `--confidence` or check sensitivity routing).
2. **Did you use the right path?** `--path=/foo.md` not `/drive/foo.md` for `drive propose`. Verify with `vobase drive ls --scope=organization` (or `vobase drive cat --path=/foo.md`).
3. **Does the agent's instructions actually reference that file?** `vobase agents inspect --id=<agentId>` returns the full `instructions` field — search it for the literal `cat /drive/<file>` reference. If the agent doesn't `cat` the file, your edit is invisible.
4. **Did the wake actually run?** `vobase agents debug wakes --conversationId=<id>` — if zero rows, the wake didn't fire (no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, conversation not assigned to an agent, pg-boss queue stuck). Check `bun run dev:server` logs.
5. **Did the wake skip reading the file?** `vobase agents debug timeline --wakeId=<id>` — look for a `bash` `tool_dispatch_started` row before the first `reply`/`send_card` dispatch. If absent, the agent decided without reading the file. Drill in with `vobase agents debug llm-io --wakeId=<id> --tool=bash --full` to see the exact bash command + result.
6. **What did the LLM actually see and decide?** `vobase agents debug llm-io --wakeId=<id>` — the user-cue text, the assistant's tool-call args, the tool result. The killer view for "agent did the wrong thing" investigations.
7. **Frozen-snapshot drift across wakes?** Compare `systemHash` columns in `agents debug wakes` for the same agent + conversation. Different hashes between two consecutive wakes = the system prompt changed mid-conversation, breaking the provider prefix cache. Real bug.
8. **Are you testing on a fresh conversation?** The agent's contact memory may carry context from prior turns. Send the test inbound from a brand-new `from:` value to get a fresh contact.

## Cleanup discipline for live tests

Always restore state after a test mutation:

```ts
// Save before
const [orig] = await sql`SELECT extracted_text FROM drive.files WHERE path=${path} AND organization_id=${ORG}`
// ... do test ...
// Restore after
await sql`UPDATE drive.files SET extracted_text=${orig.extracted_text} WHERE path=${path} AND organization_id=${ORG}`
```

The test conversations created via `sendInbound` accumulate as cruft. They're harmless but uglify the inbox. Delete them via:

```sql
DELETE FROM messaging.conversations WHERE id LIKE 'cnv0...e2e...';  -- match your test pattern
```

## Worked example — debug "agent gave the wrong answer" with verbs only

Scenario: a customer asked "are you GST registered?", staff replied via internal note "@MeriGPT yes we are", and the agent's next reply was still "I'll check with billing." The classic "agent skipped the file" failure mode.

```bash
CONV=zsjl9zl8

# 1. What was actually said (customer + agent + staff text — not just activity events)
vobase messaging messages --id=$CONV --no-json

# 2. What did staff write to the agent (rendered as the agent's bash sees it)
vobase messaging notes --id=$CONV --no-json

# 3. Which wakes fired and how much they cost
vobase agents debug wakes --conversationId=$CONV --no-json
# → table includes wakeId, trigger, turns, toolCalls, costUsd, systemHash, endReason
# Pick the staff_note wake (the one that should have read the new note)

WAKE=C0z4jUowpGdp

# 4. Did that wake actually `cat` INTERNAL-NOTES.md before replying?
vobase agents debug timeline --wakeId=$WAKE --no-json
# → look for `bash` tool_dispatch_started before any `reply` dispatch
# If absent → the agent decided without reading; that's the bug

# 5. Confirm what the LLM saw and chose
vobase agents debug llm-io --wakeId=$WAKE --no-json
# → seq=N user row shows the wake-cue text (does it inline the note body?)
# → seq=N+1 assistant shows the tool the LLM picked + its arguments
```

That walk-through is what you'd run in production with no DB access. Each verb returns a focused slice — composing them top-to-bottom answers the "did the agent see the new note? did it ignore it? what did it decide to do instead?" question without reaching for `psql`.

## What to do when the user asks how to extend the CLI

If they want a NEW verb (not just to call existing ones), point at the `cli-verb` skill — that one covers `defineCliVerb` registration, `audience` selection, `formatHint`, and module wiring. This skill is for **operating** the CLI, not extending it.

## Anti-patterns to flag

- "Just edit `/drive/BUSINESS.md` directly with `Bun.write`" — bypasses the audit trail and skips materializer re-rendering. Always go through `drive propose` so the change is recorded in `change_history`.
- "Restart the server to make the agent see the new file" — unnecessary. Drive content is read per-wake from postgres; no restart needed.
- "Open `psql` to see what the agent did" — only on local dev, and only for what the verbs don't expose. On a remote deployment use `agents debug wakes` → `timeline` → `llm-io`. The verbs are the safe seam; raw `harness.*` SQL is admin-only privilege you don't want to grant to a tenant operator.
- "Just trust `messaging show` to tell me what the agent said" — `messaging show` returns the *activity* timeline (assignee changes, status changes, change-proposal lifecycle), NOT message bodies. Use `messaging messages --id=<id>` for the actual customer/agent text. Same for notes: the inbox UI shows them card-by-card, but the agent reads them concatenated as `INTERNAL-NOTES.md`. Use `messaging notes --id=<id>` to see exactly what the agent saw.
