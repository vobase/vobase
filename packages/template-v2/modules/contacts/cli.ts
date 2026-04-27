import type { ChangedByKind } from '@modules/changes/schema'
import { insertProposal } from '@modules/changes/service/proposals'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { CONTACT_RESOURCE } from './service/changes'
import * as contactsSvc from './service/contacts'

export const contactsListVerb = defineCliVerb({
  name: 'contacts list',
  description: 'List contacts in this organization.',
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

const proposeChangeInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('markdown_patch'),
    type: z.literal('contact').default('contact'),
    id: z.string().min(1),
    field: z.string().min(1),
    mode: z.enum(['append', 'replace']).default('append'),
    body: z.string().min(1, 'markdown_patch requires --body or --body-from'),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    kind: z.literal('field_set'),
    type: z.literal('contact').default('contact'),
    id: z.string().min(1),
    field: z.string().min(1),
    from: z.string().optional(),
    to: z.string({ error: 'field_set requires --to' }),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
  }),
])

export const contactsProposeChangeVerb = defineCliVerb({
  name: 'contacts propose-change',
  description: 'Propose a change to a contact (markdown_patch on notes/profile, or field_set on scalars/attributes).',
  input: proposeChangeInput,
  body: async ({ input, ctx }) => {
    try {
      const existing = await contactsSvc.get(input.id)
      if (existing.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'contact not in this organization', errorCode: 'forbidden' }
      }
      const payload =
        input.kind === 'markdown_patch'
          ? ({ kind: 'markdown_patch', mode: input.mode, field: input.field, body: input.body } as const)
          : ({
              kind: 'field_set',
              fields: { [input.field]: { from: parseScalar(input.from), to: parseScalar(input.to) } },
            } as const)
      const result = await insertProposal({
        organizationId: ctx.organizationId,
        resourceModule: CONTACT_RESOURCE.module,
        resourceType: input.type,
        resourceId: input.id,
        payload,
        changedBy: ctx.principal.id,
        changedByKind: principalToChangedByKind(ctx.principal.kind),
        confidence: input.confidence,
        rationale: input.rationale,
      })
      return { ok: true as const, data: result }
    } catch (err) {
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
