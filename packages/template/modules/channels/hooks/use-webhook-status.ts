import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { channelsClient } from '@/lib/api-client'

export interface WebhookStatus {
  id: string
  channelInstanceId: string
  provider: string
  webhookUrl: string
  environmentLabel: string | null
  lastVerifiedAt: string | null
  lastVerifyStatus: 'ok' | 'failed' | 'pending' | null
  lastVerifyError: string | null
  registeredAt: string
}

function statusQueryKey(instanceId: string) {
  return ['channels', 'whatsapp', 'managed', instanceId, 'webhook'] as const
}

/**
 * Read the platform-side webhook registration status for a managed channel.
 * Polls every 30s while the user is on the channels page so a re-verify or
 * inbound-driven status flip surfaces without a manual refresh.
 */
export function useWebhookStatus(instanceId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: statusQueryKey(instanceId),
    enabled: opts?.enabled ?? true,
    refetchInterval: 30_000,
    queryFn: async (): Promise<WebhookStatus | null> => {
      const res = await channelsClient.whatsapp.managed[':instanceId'].webhook.$get({
        param: { instanceId },
      })
      if (!res.ok) throw new Error(`webhook status fetch failed: ${res.status}`)
      const data = (await res.json()) as { endpoint: WebhookStatus | null }
      return data.endpoint
    },
  })
}

/** Trigger a fresh challenge against the registered URL. */
export function useReVerifyWebhook(instanceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await channelsClient.whatsapp.managed[':instanceId'].webhook['re-verify'].$post({
        param: { instanceId },
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { detail?: string; webhookUrl?: string } | null
        throw new Error(err?.detail ?? `re-verify failed: ${res.status}`)
      }
      return res.json() as Promise<{ ok: true; registeredAt: string; webhookUrl: string }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: statusQueryKey(instanceId) }),
  })
}
