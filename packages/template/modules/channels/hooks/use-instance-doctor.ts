import { useMutation } from '@tanstack/react-query'

import { channelsClient } from '@/lib/api-client'

export interface DoctorCheck {
  id: string
  label: string
  status: 'green' | 'amber' | 'red'
  detail: string
}

export interface DoctorResult {
  instanceId: string
  channel: string
  checks: DoctorCheck[]
}

export function useInstanceDoctor(instanceId: string) {
  const {
    mutate: run,
    data,
    isPending,
    error,
  } = useMutation({
    mutationFn: async (): Promise<DoctorResult> => {
      const r = await channelsClient.instances[':id'].doctor.$post({ param: { id: instanceId } })
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `doctor failed: ${r.status}`)
      }
      return (await r.json()) as DoctorResult
    },
  })

  return { run, data, isPending, error }
}
