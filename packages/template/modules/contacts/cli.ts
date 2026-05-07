import type { ChangedByKind } from '@modules/changes/schema'
import { insertProposal, isPendingConflict } from '@modules/changes/service/proposals'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { CONTACT_RESOURCE, CONTACT_SCALAR_FIELDS } from './service/changes'
import * as contactsSvc from './service/contacts'

export const contactsListVerb = defineCliVerb({
  name: 'contacts list',
  description: 'List contacts in this organization.',
  audience: 'admin',
  input: z.object({
    limit: z.number().int().positive().max(500).default(50),
  }),
  body: async ({ input, ctx }) => {
    const rows = await contactsSvc.list(ctx.organizationId, { limit: input.limit })
    return {
      ok: true as const,
      data: rows.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
        segments: c.segments,
        createdAt: c.createdAt,
      })),
    }
  },
  formatHint: 'table:cols=id,displayName,email,phone,segments,createdAt',
})

export const contactsShowVerb = defineCliVerb({
  name: 'contacts show',
  description: 'Show a single contact by id.',
  audience: 'admin',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    try {
      const c = await contactsSvc.get(input.id)
      if (c.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'contact not in this organization', errorCode: 'forbidden' }
      }
      return { ok: true as const, data: c }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'not_found',
      }
    }
  },
  formatHint: 'json',
})

export const contactsUpdateVerb = defineCliVerb({
  name: 'contacts update',
  description: 'Update a contact (name, email, phone, segments, marketing opt-out).',
  audience: 'admin',
  input: z.object({
    id: z.string().min(1),
    displayName: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    segments: z.array(z.string()).optional(),
    marketingOptOut: z.boolean().optional(),
  }),
  body: async ({ input, ctx }) => {
    const { id, ...patch } = input
    try {
      const existing = await contactsSvc.get(id)
      if (existing.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'contact not in this organization', errorCode: 'forbidden' }
      }
      const updated = await contactsSvc.update(id, patch)
      return { ok: true as const, data: updated }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'update_failed',
      }
    }
  },
  formatHint: 'json',
})

// `--type` is gone (verb name pins the resource type to `contact`). `--kind`
// defaults to `field_set` via `z.preprocess` because `z.discriminatedUnion`
// can't carry a default on the literal discriminator. `markdown_patch` is
// still reachable via explicit `--kind markdown_patch`.
const proposeChangeUnion = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('markdown_patch'),
    id: z.string().min(1),
    field: z.string().min(1),
    mode: z.enum(['append', 'replace']).default('append'),
    body: z.string().min(1, 'markdown_patch requires --body or --body-from'),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
    expectedOutcome: z.string().optional(),
  }),
  z.object({
    kind: z.literal('field_set'),
    id: z.string().min(1),
    field: z.string().min(1),
    from: z.string().optional(),
    to: z.string({ error: 'field_set requires --to' }),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
    expectedOutcome: z.string().optional(),
  }),
])

const proposeChangeInput = z.preprocess((val) => {
  if (val && typeof val === 'object' && !('kind' in (val as Record<string, unknown>))) {
    return { ...(val as Record<string, unknown>), kind: 'field_set' }
  }
  return val
}, proposeChangeUnion)

export const contactsProposeChangeVerb = defineCliVerb({
  name: 'contacts propose-change',
  description:
    'Propose a structured change to a contact. Default `--kind field_set` updates a scalar (`displayName`, `email`, `phone`, `segments`, `marketingOptOut`) or namespaced attribute (`attributes.<key>`); pass `--kind markdown_patch` to append/replace a prose field. Returns `{id, status}` — `auto_applied`/`applied` means live; `pending` means a gated field queued for staff review.',
  audience: 'contact',
  input: proposeChangeInput,
  prompt: [
    'Customer-asked profile updates (email, phone, name, segments, attributes) MUST go through this verb — `/contacts/<id>/PROFILE.md` is read-only at the workspace level, so bash-edits will be rejected. Run e.g. `vobase contacts propose-change --id <contactId> --field email --to "new@example.com" --rationale "Customer asked to update on this channel"`. (`--kind field_set` is the default; pass `--kind markdown_patch --body "..."` for prose appends.) For canonical columns use the bare name (`--field phone`, `--field email`, `--field displayName`); the `attributes.<key>` namespace is only for free-form keys without a dedicated column.',
    '',
    'Inspect the returned `status` before replying:',
    '- `auto_applied` / `applied` → the change is live. Tell the customer it is done (e.g. "All set — your phone number is updated").',
    '- `pending` → a gated field touched (`displayName`, `email`); the change is queued for our team to review. Tell the customer it is logged for review.',
    '',
    'If the verb returns `ok: false` with `errorCode: pending_conflict`, this contact already has an earlier pending proposal awaiting staff review. Do NOT retry, and do NOT pretend the change went through. Tell the customer their previous request is still under review by our team and ask whether they want to wait for that decision before submitting another change.',
    '',
    'Always pass a one-sentence `--rationale` summarising what the customer asked — it renders verbatim in the staff /changes inbox.',
  ].join('\n'),
  body: async ({ input, ctx }) => {
    try {
      const existing = await contactsSvc.get(input.id)
      if (existing.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'contact not in this organization', errorCode: 'forbidden' }
      }
      // Auto-demote `attributes.<scalar>` → `<scalar>` when the tail names a
      // canonical column. The model's mental map sometimes namespaces every
      // profile field; rejecting wastes a turn (the agent often gives up
      // instead of retrying), so we silently rewrite to the right column.
      // Anything truly free-form under `attributes.*` (e.g. `attributes.industry`)
      // is left alone.
      const effectiveField =
        input.kind === 'field_set' && input.field.startsWith('attributes.')
          ? CONTACT_SCALAR_FIELDS.has(input.field.slice('attributes.'.length))
            ? input.field.slice('attributes.'.length)
            : input.field
          : input.field
      const payload =
        input.kind === 'markdown_patch'
          ? ({ kind: 'markdown_patch', mode: input.mode, field: effectiveField, body: input.body } as const)
          : ({
              kind: 'field_set',
              fields: { [effectiveField]: { from: parseScalar(input.from), to: parseScalar(input.to) } },
            } as const)
      const result = await insertProposal({
        organizationId: ctx.organizationId,
        resourceModule: CONTACT_RESOURCE.module,
        resourceType: CONTACT_RESOURCE.type,
        resourceId: input.id,
        payload,
        changedBy: ctx.principal.id,
        changedByKind: principalToChangedByKind(ctx.principal.kind),
        confidence: input.confidence,
        rationale: input.rationale,
        expectedOutcome: input.expectedOutcome,
        // Forward the wake's conversationId so `insertProposal` fires the
        // `change.proposed` / `change.auto_applied` lifecycle event into the
        // staff-inbox timeline. Absent on HTTP-RPC dispatches; those land
        // with `conversation_id = NULL` (correct — no conversation to attach).
        conversationId: ctx.wake?.conversationId ?? null,
      })
      if (result.status === 'dropped') {
        return {
          ok: false as const,
          error: `Proposal dropped — confidence ${result.confidence} is below the trivia floor.`,
          errorCode: 'trivial_proposal',
        }
      }
      return { ok: true as const, data: result }
    } catch (err) {
      // Surface the per-resource pending guard as a typed errorCode so the
      // verb prompt can teach the agent how to respond — without fabricating
      // an approval.
      if (isPendingConflict(err)) {
        return {
          ok: false as const,
          error: 'A previous change to this contact is still pending staff review.',
          errorCode: 'pending_conflict',
          data: { existingProposalId: err.details.existingProposalId },
        }
      }
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'propose_failed',
      }
    }
  },
  formatHint: 'json',
})

/** apikey principals are typically held by humans/CI — record as 'user' until ChangedByKind grows. */
function principalToChangedByKind(kind: 'user' | 'agent' | 'apikey'): ChangedByKind {
  switch (kind) {
    case 'agent':
      return 'agent'
    case 'user':
    case 'apikey':
      return 'user'
  }
}

/** Lets `--to qualified` and `--to '["qualified","vip"]'` both work without a separate JSON flag. */
function parseScalar(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export const contactsVerbs = [
  contactsListVerb,
  contactsShowVerb,
  contactsUpdateVerb,
  contactsProposeChangeVerb,
] as const
