/**
 * Contact CRUD hooks. List/detail fetches live in the pages that use them;
 * these wrappers exist because create/update fan out to multiple query keys.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Contact } from '../schema'

export interface ContactFormPayload {
  displayName?: string | null
  email?: string | null
  phone?: string | null
  segments?: string[]
  marketingOptOut?: boolean
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ContactFormPayload): Promise<Contact> => {
      const r = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(typeof err.error === 'string' ? err.error : `create contact failed: ${r.status}`)
      }
      return (await r.json()) as Contact
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ContactFormPayload }): Promise<Contact> => {
      const r = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error(`update contact failed: ${r.status}`)
      return (await r.json()) as Contact
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact', id] })
    },
  })
}
