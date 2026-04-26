/**
 * `update_contact` — operator-side write to a contact's editable fields. The
 * concierge agent never touches contact records directly (it asks staff via
 * `conv ask-staff`); operators do, because they're driving CRM-style updates
 * from the right-rail chat.
 */

import { update as updateContact } from '@modules/contacts/service/contacts'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

export const UpdateContactInputSchema = Type.Object({
  contactId: Type.String({ minLength: 1, description: 'Contact id (nanoid).' }),
  patch: Type.Object({
    displayName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    segments: Type.Optional(Type.Array(Type.String())),
  }),
})

export type UpdateContactInput = Static<typeof UpdateContactInputSchema>

export const updateContactTool: AgentTool<UpdateContactInput, { id: string }> = {
  name: 'update_contact',
  description:
    'Update editable fields on a contact (displayName, phone, email, segments). Returns the contact id. Operator-only.',
  inputSchema: UpdateContactInputSchema,
  parallelGroup: 'never',

  async execute(args, _ctx: ToolContext): Promise<ToolResult<{ id: string }>> {
    if (!Value.Check(UpdateContactInputSchema, args)) {
      const first = Value.Errors(UpdateContactInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid update_contact input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
      const row = await updateContact(args.contactId, args.patch)
      return { ok: true, content: { id: row.id } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'update failed',
        errorCode: 'UPDATE_ERROR',
      }
    }
  },
}
