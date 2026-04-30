/**
 * `update_contact` — operator-side write to a contact's editable fields. On
 * the conversation lane the agent never touches contact records directly (it
 * asks staff via `add_note` with `mentions`); on the standalone (operator)
 * lane it does, because staff are driving CRM-style updates from the
 * right-rail chat.
 */

import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { update as updateContact } from '../service/contacts'

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

export const updateContactTool = defineAgentTool({
  name: 'update_contact',
  description:
    'Update editable fields on a contact (displayName, phone, email, segments). Returns the contact id. Operator-only.',
  schema: UpdateContactInputSchema,
  errorCode: 'UPDATE_ERROR',
  lane: 'standalone',
  prompt:
    'Use for CRM-style edits the staff explicitly requested. Conversation-lane wakes must NOT call this — call `add_note` with `mentions` to loop in a staff member instead.',
  async run(args) {
    const row = await updateContact(args.contactId, args.patch)
    return { id: row.id }
  },
})
