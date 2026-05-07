/**
 * `propose_contact_update` — conversation-lane, customer-facing tool that
 * routes any customer-asked profile change through the change-proposal
 * pipeline. Sole purpose is to give the model a *single deterministic call*
 * for "the customer asked me to update their email/phone/name", so the
 * default polite-reply ("logged for our team to review") only ships when an
 * actual proposal exists.
 *
 * Why this is separate from `update_contact` (which is `lane: 'standalone'`,
 * operator-driven, direct mutation): conversation-lane edits MUST go through
 * proposals so gated fields (`displayName`, `email`) queue for staff review,
 * while non-gated fields (`phone`, `segments`, `attributes.*`) auto-apply but
 * still surface in the audit/history pipeline. The `propose_contact_update`
 * tool returns `status: 'pending' | 'auto_written'` so the model knows
 * exactly how to phrase the customer reply.
 *
 * Resolves `contactId` from `ctx.conversationId` rather than taking it as an
 * argument — the model can't choose the wrong contact.
 */

import { insertProposal } from '@modules/changes/service/proposals'
import { get as getContact } from '@modules/contacts/service/contacts'
import { get as getConversation } from '@modules/messaging/service/conversations'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool, validation } from '@vobase/core'

import { CONTACT_GATED_FIELDS } from '~/wake/observers/gated-fields'
import { type AttrLabelMap, buildFieldSetCopy, loadContactAttrLabels } from '~/wake/observers/proposal-copy'
import type { FieldDiff } from '~/wake/profile-frontmatter'
import { CONTACT_RESOURCE, CONTACT_SCALAR_FIELDS } from '../service/changes'

export const ProposeContactUpdateInputSchema = Type.Object({
  patch: Type.Object(
    {
      displayName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      segments: Type.Optional(Type.Array(Type.String())),
      marketingOptOut: Type.Optional(Type.Boolean()),
      attributes: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    {
      description:
        'Fields to update. Omit a field to leave it unchanged. `attributes` is a flat map of attribute keys (no `attributes.` prefix in the keys) — use it for nested fields like `industry`, `company_size`, `renewal_date`, etc.',
    },
  ),
  rationale: Type.String({
    minLength: 1,
    description:
      'One-sentence summary of WHY this change is being proposed (typically a paraphrase of what the customer just asked). Renders verbatim in the staff /changes inbox, so write it for a human reviewer.',
  }),
})

export type ProposeContactUpdateInput = Static<typeof ProposeContactUpdateInputSchema>

export const proposeContactUpdateTool = defineAgentTool({
  name: 'propose_contact_update',
  description:
    "Propose a structured update to the current conversation's contact. Top-level scalars: `displayName`, `email`, `phone`, `segments`, `marketingOptOut`. Nested keys go in `attributes`. Returns `{proposalId, status, fieldsTouched, replyHint}` — `status: 'pending'` means a gated field touched and the change queues for staff review (tell the customer it's logged for review); `status: 'auto_written'` means the change applied immediately (tell the customer it's done). Always set `rationale` to a one-sentence summary of what the customer asked.",
  schema: ProposeContactUpdateInputSchema,
  errorCode: 'PROPOSE_CONTACT_UPDATE_ERROR',
  audience: 'customer',
  lane: 'conversation',
  prompt: [
    'For ANY customer-driven profile-field update — email, phone, displayName, segments, attributes — call this tool. Bash-editing `/contacts/<id>/profile.md` is reserved for staff/admin operator workflows.',
    '',
    'The returned `status` tells you EXACTLY how to phrase your reply:',
    '- `auto_written` → the change is live. Tell the customer it\'s done (e.g. "All set — your phone number is updated").',
    "- `pending` → a gated field needed staff approval. Tell the customer it's logged for our team to review.",
    "- `no_op` → the values you proposed already match what's on file. Acknowledge with no change action.",
    '',
    "Never reply 'logged for review' without first calling this tool and seeing `status: pending` come back. If the tool errors or returns `no_op` and you still want staff sign-off (e.g. customer is correcting a misunderstanding), say so plainly instead of inventing a phantom approval.",
  ].join('\n'),
  async run(args, ctx) {
    const conv = await getConversation(ctx.conversationId)
    const contact = await getContact(conv.contactId)

    const fields: Record<string, FieldDiff> = {}
    if ('displayName' in args.patch && args.patch.displayName !== contact.displayName) {
      fields.displayName = { from: contact.displayName, to: args.patch.displayName ?? null }
    }
    if ('email' in args.patch && args.patch.email !== contact.email) {
      fields.email = { from: contact.email, to: args.patch.email ?? null }
    }
    if ('phone' in args.patch && args.patch.phone !== contact.phone) {
      fields.phone = { from: contact.phone, to: args.patch.phone ?? null }
    }
    if (args.patch.segments && !arraysEqual(args.patch.segments, contact.segments ?? [])) {
      fields.segments = { from: contact.segments ?? [], to: args.patch.segments }
    }
    if ('marketingOptOut' in args.patch && Boolean(args.patch.marketingOptOut) !== Boolean(contact.marketingOptOut)) {
      fields.marketingOptOut = { from: Boolean(contact.marketingOptOut), to: Boolean(args.patch.marketingOptOut) }
    }
    if (args.patch.attributes) {
      const currentAttrs = (contact.attributes ?? {}) as Record<string, unknown>
      for (const [key, value] of Object.entries(args.patch.attributes)) {
        if (!key) continue
        const namespacedKey = `attributes.${key}`
        const prior = currentAttrs[key] ?? null
        if (!shallowEqual(prior, value)) {
          fields[namespacedKey] = { from: prior, to: value }
        }
      }
    }

    const fieldsTouched = Object.keys(fields)
    if (fieldsTouched.length === 0) {
      return {
        proposalId: null,
        status: 'no_op' as const,
        fieldsTouched: [] as string[],
        replyHint: "No values would change — the patch you proposed already matches what's on file.",
      }
    }

    const knownTopLevel = CONTACT_SCALAR_FIELDS
    for (const key of fieldsTouched) {
      if (key.startsWith('attributes.')) continue
      if (!knownTopLevel.has(key)) {
        throw validation({ key }, `propose_contact_update: unknown field '${key}'`)
      }
    }

    const subjectName = contact.displayName ?? contact.phone ?? contact.email ?? contact.id
    const attrLabels: AttrLabelMap = await loadContactAttrLabels(ctx.organizationId).catch(
      () => new Map() as AttrLabelMap,
    )
    const copy = buildFieldSetCopy({
      subjectName,
      subjectNoun: 'contact',
      fields,
      requiresApproval: false,
      requiresApprovalForFields: CONTACT_GATED_FIELDS,
      attrLabels,
    })

    try {
      const result = await insertProposal({
        organizationId: ctx.organizationId,
        resourceModule: CONTACT_RESOURCE.module,
        resourceType: CONTACT_RESOURCE.type,
        resourceId: conv.contactId,
        payload: { kind: 'field_set', fields },
        changedBy: `agent:${ctx.agentId}`,
        changedByKind: 'agent',
        rationale: args.rationale,
        expectedOutcome: copy.expectedOutcome,
        conversationId: ctx.conversationId,
      })
      return {
        proposalId: result.id,
        status: result.status,
        fieldsTouched,
        replyHint:
          result.status === 'pending'
            ? "Tell the customer it's logged for our team to review (a gated field was touched)."
            : 'Tell the customer the change is done (it applied immediately and is now on file).',
      }
    } catch (err) {
      // Idempotency on rapid double-call: surface the existing pending row's
      // shape so the model still gets a deterministic 'pending' answer instead
      // of a hard error.
      if (err instanceof Error && /already has a pending proposal/.test(err.message)) {
        return {
          proposalId: null,
          status: 'pending' as const,
          fieldsTouched,
          replyHint:
            'Another change for this contact is already pending staff review — tell the customer their request is logged.',
        }
      }
      throw err
    }
  },
})

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}
