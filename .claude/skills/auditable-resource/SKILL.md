---
name: auditable-resource
description: |
  Wire a module's resource into the generic change-proposal / change-history pipeline so every mutation is auditable, agent-proposable, and (optionally) gated behind staff approval. Use this skill when adding a new resource type that needs proposal-plus-decide semantics, a propose-CLI verb, or a tamper-evident edit history. Also use when the user says "make this auditable", "agents should propose changes to X", "needs an approval queue", "track edits to Y", "register a materializer", or "add a propose-change verb for module Z".
---

# auditable-resource

Modules opt into the generic change-proposals umbrella by registering a **materializer** for one or more `(resourceModule, resourceType)` pairs. Once registered, the resource gets:

- A typed `insertProposal` entry point (auto-applies if `requiresApproval=false`, else queues for staff).
- A staff inbox at `/changes` with `<DiffView>` rendering the payload.
- A tamper-evident `change_history` row per applied mutation, linked to the proposal that produced it.
- An `agent_event` (`change_approved` / `change_rejected`) emitted into the conversation journal when the proposal originated from an agent wake.

The umbrella lives at `packages/template-v2/modules/changes/`. Resource modules contribute four small pieces — they never touch `changeProposals` / `changeHistory` directly (`check:shape` enforces this).

## When to apply

- A new resource type that staff want to audit: who changed what, when, with what before/after.
- A resource where agent writes should be **proposed** instead of auto-applied — `learned_skill`, `drive_doc`, anything tied to the brand voice or a customer-visible artifact.
- A resource where agent writes are auto-applied today but you still want a single audit trail — `contact`, `agent_memory`. Use `requiresApproval: false` and the changes pipeline still records history.

Skip when the mutation has no business meaning to surface to staff (intra-tool scratchpad writes, idempotent caches) or when it isn't user-visible (build artifacts, derived rollups).

## Canonical example

`packages/template-v2/modules/contacts/` is the reference implementation — read these four files before copying:

- `service/changes.ts` — materializer (load, apply payload, write back).
- `module.ts` — `init` registers the materializer with `requiresApproval: false`.
- `cli.ts` — `contactsProposeChangeVerb` defined via `defineCliVerb`.
- `handlers/index.ts` — CRUD handlers call `recordChange` after each mutation so direct staff edits also produce a history row.

## Four-file recipe

### 1. `service/changes.ts` — the materializer

```ts
import type { MaterializeResult, Materializer, TxLike } from '@modules/changes/service/proposals'
import type { ChangePayload } from '@vobase/core'
import { conflict, validation } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { Widget } from '../schema'
import { widgets } from '../schema'

export const WIDGET_RESOURCE = { module: 'widgets', type: 'widget' } as const

export const widgetChangeMaterializer: Materializer = async (proposal, tx) => {
  const before = await loadWidget(tx, proposal.resourceId)
  const after = applyPayload(before, proposal.payload)
  await writeWidget(tx, proposal.resourceId, after)
  return { resultId: proposal.resourceId, before, after } satisfies MaterializeResult
}
```

Rules:
- The materializer **must** use the `tx` argument for every read/write — not the bound singleton service. The proposal/decide path runs inside a transaction and the singleton `db` handle is the wrong one.
- Return `{ resultId, before, after }`. `before` and `after` go into `change_history` verbatim; keep them JSON-serialisable (no class instances, no `bigint`).
- Throw `conflict()` for "row not found", `validation()` for unsupported payload shape. Both flow through the typed error contract.
- When the resource only ever takes `markdown_patch`, import `assertMarkdownPatch` from `@modules/changes/service/proposals` and skip the dispatch boilerplate (see `agents/service/changes.ts` and `drive/service/changes.ts`).

Export the `(module, type)` pair as a `const` tuple — the verb body and the module init both import it, so a typo fails at compile time.

### 2. `module.ts` — register at init

```ts
import { registerChangeMaterializer } from '@modules/changes/service/proposals'

import { WIDGET_RESOURCE, widgetChangeMaterializer } from './service/changes'
import { widgetVerbs } from './cli'

const widgets: ModuleDef = {
  name: 'widgets',
  requires: ['changes'],
  init(ctx) {
    registerChangeMaterializer({
      resourceModule: WIDGET_RESOURCE.module,
      resourceType: WIDGET_RESOURCE.type,
      requiresApproval: true,        // false ⇒ insert + apply atomically; true ⇒ queue for staff
      materialize: widgetChangeMaterializer,
    })
    ctx.cli.registerAll(widgetVerbs)
  },
}
```

Rules:
- `requires: ['changes']` is mandatory — the registry must be installed before your `init` runs.
- `requiresApproval` is the **only** lever that decides whether the proposal auto-applies. Callers cannot override it; `insertProposal` derives status from the registry.
- One materializer per `(module, type)` — re-registering the same pair throws at boot.

### 3. `cli.ts` — propose-change verb via `defineCliVerb`

```ts
const proposeChangeInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('markdown_patch'),
    type: z.literal('widget').default('widget'),
    id: z.string().min(1),
    field: z.string().min(1),
    mode: z.enum(['append', 'replace']).default('append'),
    body: z.string().min(1, 'markdown_patch requires --body or --body-from'),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    kind: z.literal('field_set'),
    type: z.literal('widget').default('widget'),
    id: z.string().min(1),
    field: z.string().min(1),
    from: z.string().optional(),
    to: z.string({ error: 'field_set requires --to' }),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
  }),
])

export const widgetsProposeChangeVerb = defineCliVerb({
  name: 'widgets propose-change',
  description: 'Propose a change to a widget.',
  input: proposeChangeInput,
  body: async ({ input, ctx }) => {
    const payload =
      input.kind === 'markdown_patch'
        ? ({ kind: 'markdown_patch', mode: input.mode, field: input.field, body: input.body } as const)
        : ({
            kind: 'field_set',
            fields: { [input.field]: { from: parseScalar(input.from), to: parseScalar(input.to) } },
          } as const)
    const result = await insertProposal({
      organizationId: ctx.organizationId,
      resourceModule: WIDGET_RESOURCE.module,
      resourceType: input.type,
      resourceId: input.id,
      payload,
      changedBy: ctx.principal.id,
      changedByKind: principalToChangedByKind(ctx.principal.kind),
      confidence: input.confidence,
      rationale: input.rationale,
    })
    return { ok: true as const, data: result }
  },
  formatHint: 'json',
})
```

Rules:
- The verb body **imports `insertProposal` directly** — no service shim, no port lookup. The cross-transport-parity test (`packages/core/src/workspace/cli/parity.test.ts`) covers in-process and HTTP-RPC paths from the same body.
- Validate payload shape at the verb boundary with a Zod discriminated union so `--confidence 1.5` errors before `insertProposal` runs.
- Tenant-scope every reference: re-fetch the row by id, assert `organizationId === ctx.organizationId`, return `{ ok: false, errorCode: 'forbidden' }` otherwise.
- See `.claude/skills/cli-verb/SKILL.md` for the broader verb registration pattern.

### 4. `handlers/index.ts` — call `recordChange` after staff CRUD

When staff edit the resource directly through your module's HTTP handlers (not via a proposal), call `recordChange` so the audit trail is uniform:

```ts
import { recordChange } from '@modules/changes/service/proposals'
import { WIDGET_RESOURCE } from '../service/changes'

routes.patch('/:id', zValidator('json', updateInput), async (c) => {
  const before = await widgetsService.get(c.req.param('id'))
  const after = await widgetsService.update(c.req.param('id'), c.req.valid('json'))
  await recordChange({
    organizationId: ctx.organizationId,
    resourceModule: WIDGET_RESOURCE.module,
    resourceType: WIDGET_RESOURCE.type,
    resourceId: after.id,
    payload: { kind: 'field_set', fields: diffFields(before, after) },
    before,
    after,
    changedBy: ctx.user.id,
    changedByKind: 'user',
  })
  return c.json(after)
})
```

`recordChange` writes a `change_history` row without involving a proposal (`appliedProposalId = null`). Use it whenever the mutation didn't flow through `insertProposal` — direct PATCH endpoints, scheduled jobs, internal admin tools.

## Payload conventions

`ChangePayload` is a discriminated union from `@vobase/core` with three `kind` values. Pick the one that matches how the field is edited:

### `markdown_patch` — long-form prose fields

```ts
{ kind: 'markdown_patch', mode: 'append' | 'replace', field: string, body: string }
```

Worked examples:
- `agent_skill`: `{ kind: 'markdown_patch', mode: 'replace', field: 'body', body: '# How to escalate VIP cases…' }` — `resourceId` is the skill name.
- `agent_memory`: `{ kind: 'markdown_patch', mode: 'append', field: 'workingMemory', body: '- Customer prefers Mandarin' }` — `resourceId` is the agent id; append concatenates with `\n`.
- `drive_doc`: `{ kind: 'markdown_patch', mode: 'replace', field: 'content', body: '# Refund policy…' }` — `resourceId` is the scope-relative path (e.g. `/policies/refunds.md`).
- `contact.notes`: `{ kind: 'markdown_patch', mode: 'append', field: 'notes', body: '- Mentioned subscribing to enterprise tier' }`.

`<DiffView>` renders these with jsdiff line-level highlighting.

### `field_set` — scalar columns + JSONB attribute keys

```ts
{ kind: 'field_set', fields: Record<string, { from?: unknown; to: unknown }> }
```

Worked examples:
- `contact.segments`: `{ fields: { segments: { from: ['lead'], to: ['lead', 'qualified'] } } }`.
- `contact.attributes.tier`: `{ fields: { 'attributes.tier': { from: 'free', to: 'pro' } } }` — keys with the `attributes.` prefix patch the JSONB column.
- Combined: multiple keys in one payload form one atomic mutation.

`<DiffView>` renders these as a two-column table.

### `json_patch` — RFC 6902 ops on JSONB blobs

```ts
{ kind: 'json_patch', ops: Array<{ op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }> }
```

Reach for this only when the resource is fundamentally a JSONB blob (config trees, structured form responses) and `field_set` would lose nesting fidelity. The contacts materializer rejects this `kind` outright — most resource types do.

`<DiffView>` renders these as an ops list.

### Choosing `requiresApproval`

| Pick `false` (auto-apply) when… | Pick `true` (queue for staff) when… |
|---|---|
| The agent's blast radius is the agent itself (`agent_memory`). | The change is customer-visible (`learned_skill` shapes future replies). |
| The user expects "the agent updates the contact CRM in real time" (`contact`). | The change is an artifact staff own (`drive_doc`). |
| The mutation is fully reversible from the audit log. | A bad write would require a new wake to walk back. |
| Confidence is irrelevant — the source-of-truth IS what the agent wrote. | Confidence and rationale should gate human review. |

When in doubt, start with `requiresApproval: true`. Lowering the bar later is one-line; raising it after agents have learned to spam writes is harder.

## What NOT to do

- **Don't write your own proposals/history table.** The umbrella schema is shared across modules so the staff inbox stays one query, one component, one realtime channel.
- **Don't insert into `change_proposals` or `change_history` from your module.** `check:shape` blocks any path other than `modules/changes/service/proposals.ts`. Use `insertProposal` and `recordChange`.
- **Don't accept a `status` argument on the propose path.** `InsertProposalInput` deliberately omits it; status is derived from the registry's `requiresApproval`.
- **Don't bypass the registry by calling the materializer directly.** The proposal row, history row, and `change_approved` journal event must land in the same transaction.
- **Don't render your own diff component.** `<DiffView payload>` already dispatches on `kind`. Add a new variant inside `<DiffView>` if a new `kind` ever lands — never shadow it per module.
- **Don't auto-apply via the framework's "force" path.** There isn't one. If you find yourself wanting it, the materializer should be re-registered with `requiresApproval: false` instead.
- **Don't skip `recordChange` in CRUD handlers.** Audit gaps appear silently — staff trust the inbox to show every mutation, not just agent-initiated ones.
- **Don't read or write across pgSchemas with a hard FK.** `change_proposals` lives in the `changes` pgSchema; cross-schema soft FKs only.

## Verification

After wiring all four files:

- `bun run typecheck` — registry import paths and the materializer signature should compile clean.
- `bun run check` — `check:shape` will fail if your module accidentally inserts into `change_proposals` / `change_history` from anywhere outside `modules/changes/service/proposals.ts`.
- `bun run test` — add an E2E test mirroring `tests/e2e/contacts-change-flow.test.ts`: agent CLI propose → `GET /api/changes/inbox` → POST decide → `change_history` row exists → `appliedHistoryId` and `appliedProposalId` link.
- Manual dogfood: `vobase widgets propose-change --kind markdown_patch --id <wid> --field notes --body "test"` from the agent bash sandbox; visit `/changes`; approve; confirm the resource updated and a history row appeared.

## References

- Canonical materializer: `packages/template-v2/modules/contacts/service/changes.ts`
- Canonical CLI verb: `packages/template-v2/modules/contacts/cli.ts` (`contactsProposeChangeVerb`)
- Canonical registration: `packages/template-v2/modules/contacts/module.ts`
- Auto-apply variant (no approval gate): `agentMemoryMaterializer` in `packages/template-v2/modules/agents/service/changes.ts`
- Approval-gated variant: `agentSkillMaterializer` in `packages/template-v2/modules/agents/service/changes.ts`
- Stub variant (no real write yet): `driveDocMaterializer` in `packages/template-v2/modules/drive/service/changes.ts`
- Service contract: `packages/template-v2/modules/changes/service/proposals.ts`
- Shared diff component: `packages/template-v2/src/components/changes/diff-view.tsx`
- Sibling skill: `.claude/skills/cli-verb/SKILL.md`
