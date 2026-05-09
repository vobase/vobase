---
name: vobase-cli-ops
description: |
  Operate a live vobase tenant via the `vobase` CLI binary — debug agent behavior, mutate tenant data, drive before/after agent-performance tests, and manage drive content / contacts / conversations from the terminal. Use this skill whenever the user wants to "debug the agent", "improve the agent", "make the agent answer X differently", "test what the agent says when ...", "update a contact / drive doc / pricing / policy", "close a conversation", "reassign a conversation", "add a learned skill", "see what verbs are available", "send a test inbound message", "reproduce a customer scenario", "run an E2E against the live tenant", or asks how to use `vobase auth login` / `vobase drive propose` / `vobase contacts propose-change` / `vobase conv reassign` / `vobase messaging close` / `vobase messaging show` / `vobase team list` / `vobase agents show`. Also triggers for "what should I run to make the agent cite a new policy", "how do I test agent behavior end-to-end", or any request to make the agent's response change without editing core source code.
---

# vobase CLI ops — debugging and improving a live tenant

The vobase CLI is the operator's seam for a running tenant. It walks the catalog endpoint, dispatches verbs over HTTP-RPC, and changes real tenant state. Most "improve the agent" workflows are CLI-driven: the agent's behavior reads from drive content + memory + contact state, all of which the CLI can mutate.

## Why this exists

When the user asks "how do I make the agent cite our new SLA?" or "the agent should know about beta-tester discounts" or "Marcus's contact info is wrong", the answer is almost never "edit source code and redeploy." It's a CLI mutation. This skill captures the verb-by-verb mechanics, flag names, path conventions, approval routing, and end-to-end agent-comparison patterns that took a real session to discover.

## Setup — pick a tenant + authenticate

Each `~/.vobase/<name>.json` file is one tenant. Switch via `--config <name>` or `VOBASE_CONFIG=<name>`. The catalog cache lives at `~/.vobase/<name>.cache.json` (auto-invalidates on etag drift; force with `--refresh`).

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
DEV=$(curl -s -i -X POST "$BASE/api/auth/dev-login" \
  -H "Content-Type: application/json" -d '{"email":"alice@meridian.dev"}')
COOKIE=$(echo "$DEV" | grep -i '^set-cookie:' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

CODE=$(curl -s -X POST "$BASE/api/auth/cli-grant" | jq -r .code)

curl -s -X POST "$BASE/api/auth/cli-grant/confirm" \
  -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"name\":\"e2e\"}"

KEY=$(curl -s "$BASE/api/auth/cli-grant/poll?code=$CODE" | jq -r .apiKey)
# Save to ~/.vobase/<name>.json with chmod 0600 — see references/programmatic-auth.sh
```

## Discovering verbs

The catalog is **filtered by audience tier** (`contact` < `staff` < `admin`). What you see depends on your role:

```bash
vobase --help                 # group-level overview
vobase --refresh              # force re-fetch
vobase <group> --help         # detail for one group (e.g. `vobase team --help`)
```

Anonymous calls to `/api/cli/verbs` are blocked at 401. Authenticated members see contact + staff verbs. Admin keys see all verbs including `system`, `install`, `drive cat`.

## The staff-tier verb catalog (verified end-to-end)

These are the 10 staff-tier verbs in the canonical template. **Flag names are the most error-prone part of CLI use** — copy from the table verbatim.

| Verb | Required flags | Purpose | Read/Write |
|---|---|---|---|
| `team list` | — | Staff directory | read |
| `team get` | `--user=<userId>` | Single staff member | read |
| `agents show` | `--id=<agentId>` | Agent definition (instructions, model, working_memory) | read |
| `messaging show` | `--id=<conversationId>` | Conversation summary + recent activity | read |
| `messaging close` | `--id=<conversationId>` (`--reason` optional) | Resolve a conversation | write |
| `conv reassign` | `--conversationId=<id>` `--to=user:<id>\|agent:<id>\|unassigned` | Hand off conversation | write |
| `drive search` | `--query=<text>` `--scope=organization` | Hybrid search across drive | read |
| `drive propose` | `--path=/<scope-relative>` `--body=<content>` `--rationale=...` `--confidence=0.95` | Propose a markdown_patch to a drive file | write (proposal) |
| `drive upload` | `--path=<local-file>` `--scope=organization` `--basePath=/` | Upload a local file into drive | write |
| `contacts propose-change` | `--id=<contactId>` `--field=<name>` `--to=<value>` `--rationale=...` `--confidence=0.95` | Propose a contact field update | write (proposal) |

### Critical flag-name gotchas

- `team get` uses `--user`, NOT `--userId`.
- `messaging show` and `messaging close` use `--id`, NOT `--conversationId`.
- `conv reassign` uses `--conversationId`, NOT `--id` (yes, the inverse of messaging — easy to swap).
- `contacts propose-change` uses `--field` + `--to`, NOT `--field=` + `--value=`.
- `drive propose` uses `--body`, NOT `--content`.
- `drive upload --path` is the **local source path**; the file lands at `basePath + filename`. `--scope` is required; `--scopeId` required for non-organization scopes.

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
| Agent should remember a customer fact | `contacts propose-change --id=<contactId> --field=<attribute> --to=<value>` — the agent's wake reads contact state automatically. |
| Agent should change tone / behavior universally | Update `agentDefinitions.instructions` directly via DB or admin UI (no current CLI verb for this — use Drizzle Studio: `bun run db:studio`). |
| Agent should remember a session-level lesson | Update `agentDefinitions.workingMemory` (no current CLI verb). For agent-driven self-update, the agent uses the `remember` tool from inside a wake. |

**The "add a new file" trap.** If you upload `/drive/foo.md` but the agent's instructions don't tell it to `cat /drive/foo.md`, it won't read the file. Always update an existing file the agent already references.

## End-to-end agent behavior tests — before/after pattern

The proven workflow for "verify a CLI mutation actually changes agent behavior":

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

## DB cheat sheet (when CLI verbs aren't enough)

For ad-hoc inspection use Drizzle Studio: `cd packages/template && bun run db:studio`. For automation:

```sql
-- Connect: postgres://vobase:vobase@localhost:5432/vobase

-- Conversations
SELECT id, status, assignee, contact_id FROM messaging.conversations LIMIT 10;
-- assignee is a single text column: 'user:<id>' or 'agent:<id>'
-- status: 'active' | 'awaiting_approval' | 'resolved' | 'snoozed'

-- Messages (content is JSONB)
SELECT id, role, content->>'text' AS text FROM messaging.messages
WHERE conversation_id = $1 ORDER BY created_at;

-- Drive files (content lives in extracted_text, NOT 'content')
SELECT id, path, length(extracted_text) FROM drive.files WHERE scope='organization';

-- Agents
SELECT id, name, working_memory FROM agents.agent_definitions;

-- Contacts
SELECT id, display_name, attributes FROM contacts.contacts;

-- Pending proposals
SELECT id, resource_module, resource_type, resource_id, status, payload
FROM changes.change_proposals WHERE status='pending';
```

## Path-resolution trap, recap

| You write | Stored as | Visible to agent at |
|---|---|---|
| `--path=/pricing.md` | `/pricing.md` | `/drive/pricing.md` ✓ |
| `--path=/drive/pricing.md` | `/drive/pricing.md` | `/drive/drive/pricing.md` ✗ (unreachable) |
| `drive upload --path=/tmp/x.md --basePath=/policies/` | `/policies/x.md` | `/drive/policies/x.md` ✓ |

## Audience tier truth table

| Caller | Sees | How |
|---|---|---|
| anonymous (no Bearer) | nothing — 401 from middleware | api-key middleware blocks first |
| member role with API key | `audience: 'contact'` + `'staff'` verbs | `getAudience()` returns `'staff'` |
| admin role with API key | all verbs including admin-only | `getAudience()` returns `'admin'` |
| agent's bash sandbox | filtered by wake's `audienceTier` (typically `'contact'` for inbound, `'staff'` for staff-note wakes) | `isVerbVisible(verb.audience, wake.audienceTier)` |

## When a CLI mutation didn't change the agent

Diagnosis order:

1. **Did the proposal actually apply?** Check `status` field of the propose response. `auto_written` = applied; `pending` = needs decide; `dropped` = below threshold (raise `--confidence` or check sensitivity routing).
2. **Did you use the right path?** `--path=/foo.md` not `/drive/foo.md` for `drive propose`. Verify with `SELECT path FROM drive.files WHERE path LIKE '%foo%'`.
3. **Does the agent's instructions actually reference that file?** `SELECT instructions FROM agents.agent_definitions WHERE id=$1` and look for the literal `cat /drive/<file>` reference. If the agent doesn't `cat` the file, your edit is invisible.
4. **Are you testing on a fresh conversation?** The agent's contact memory may carry context from prior turns. Send the test inbound from a brand-new `from:` value to get a fresh contact.
5. **Did the wake actually run?** Check `messaging.messages WHERE conversation_id=$1 AND role='agent'` — if no agent row, the wake failed (look for `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` in env, or check `bun run dev:server` logs).

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

## What to do when the user asks how to extend the CLI

If they want a NEW verb (not just to call existing ones), point at the `cli-verb` skill — that one covers `defineCliVerb` registration, `audience` selection, `formatHint`, and module wiring. This skill is for **operating** the CLI, not extending it.

## Anti-patterns to flag

- "Just edit `/drive/BUSINESS.md` directly with `Bun.write`" — bypasses the audit trail and skips materializer re-rendering. Always go through `drive propose` so the change is recorded in `change_history`.
- "Restart the server to make the agent see the new file" — unnecessary. Drive content is read per-wake from postgres; no restart needed.
- "Add `vobase contacts list` to the catalog so I can find a contact" — that's an admin verb; non-admin staff can't list contacts (privacy). Use Drizzle Studio for admin-side data inspection or query the DB directly.
