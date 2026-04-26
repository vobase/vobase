/**
 * `vobase contacts {list,show,update}` verb registrations.
 *
 * Verb bodies route through the singleton service exports — same path the
 * agent's wake harness uses, so in-process and HTTP-RPC transports converge
 * on identical behavior. The CLI binary's generic table renderer reads
 * `formatHint` from the catalog; output shape stays JSON-compatible for
 * `--json` mode.
 */

import { type CliVerbRegistry, defineCliVerb } from '@vobase/core'
import { z } from 'zod'

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
  body: async ({ input }) => {
    try {
      const c = await contactsSvc.get(input.id)
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
  body: async ({ input }) => {
    const { id, ...patch } = input
    try {
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

/** Register all contacts verbs. Called from `modules/contacts/module.ts:init`. */
export function registerContactsVerbs(cli: CliVerbRegistry): void {
  cli.register(contactsListVerb)
  cli.register(contactsShowVerb)
  cli.register(contactsUpdateVerb)
}
