/**
 * `update_contact` — operator-side write to a contact's editable fields. The
 * concierge agent never touches contact records directly (it asks staff via
 * `conv ask-staff`); operators do, because they're driving CRM-style updates
 * from the right-rail chat.
 */

import { update as updateContact } from '@modules/contacts/service/contacts'
import { type Static, Type } from '@sinclair/typebox'

import { defineAgentTool } from '../shared/define-tool'

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
  async run(args) {
    const row = await updateContact(args.contactId, args.patch)
    return { id: row.id }
  },
})
