/**
 * Frontend wrapper around the generic `/api/settings/org-settings/:key` GET+PUT
 * surface. Returns the current value plus a setter, with toast-on-error and
 * cache invalidation already wired so callers don't re-clone ~20 lines of
 * useQuery + useMutation per setting.
 */

import type { OrgSettingKey } from '@modules/settings/service/org-settings'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { settingsClient } from '@/lib/api-client'

interface OrgSettingResponse {
  key: string
  value: string | null
}

export function useOrgSetting(key: OrgSettingKey): {
  value: string | null
  setValue: (value: string | null) => void
  isPending: boolean
} {
  const qc = useQueryClient()
  const queryKey = ['settings', 'org-settings', key] as const

  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<OrgSettingResponse> => {
      const r = await settingsClient['org-settings'][':key'].$get({ param: { key } })
      if (!r.ok) throw new Error(`org-settings.get failed: ${r.status}`)
      return (await r.json()) as OrgSettingResponse
    },
  })

  const mutation = useMutation({
    mutationFn: async (value: string | null): Promise<void> => {
      const r = await settingsClient['org-settings'][':key'].$put({ param: { key }, json: { value } })
      if (!r.ok) throw new Error(`org-settings.put failed: ${r.status}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  })

  return { value: data?.value ?? null, setValue: mutation.mutate, isPending: mutation.isPending }
}
