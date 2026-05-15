/**
 * Minimal "Connect platform channel" dialog. Operators trigger it from the
 * placeholder row that the channels table renders for every managed kind
 * the org hasn't claimed yet (sandbox + notification today; future kinds
 * fall in automatically via `ManagedChannelKind`).
 *
 * The dialog asks for one decision — which agent should own incoming
 * conversations on this channel — and then runs the same `claimAndBootstrap`
 * sequence the previous Sheet/Dialog pair used. Notification-tier claims
 * ignore `defaultAssignee` on the server (staff WA replies route via
 * `org_settings.defaultOperatorAgentId`, not the channel row), so the
 * picker is shown for UX consistency but doesn't drive behaviour there.
 */
import { useAgentDefinitions } from '@modules/agents/hooks/use-agent-definitions'
import type { ManagedChannelKind } from '@modules/channels/managed/registry'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { channelsClient } from '@/lib/api-client'

interface ClaimSuccessResponse {
  status: 'claimed' | 'already_claimed'
  instance: { id: string; displayName: string }
  webhook?: { ok: true; registeredAt: string } | { ok: false; detail: string }
}

interface ClaimErrorResponse {
  error: string
  detail?: string
  code?: string | null
}

const KIND_COPY: Record<ManagedChannelKind, { title: string; description: string; cta: string }> = {
  sandbox: {
    title: 'Connect platform sandbox',
    description:
      'Claim a shared platform-managed WhatsApp number for testing. Customers reach you by sending `/link <endpointId>` to that number first.',
    cta: 'Connect sandbox',
  },
  notification: {
    title: 'Connect platform notification',
    description:
      'Claim a platform-managed WhatsApp number used exclusively for staff notifications. Staff link their phone in their profile to receive @-mention pings here.',
    cta: 'Connect notification',
  },
}

async function postClaim(kind: ManagedChannelKind, defaultAssignee: string | null): Promise<ClaimSuccessResponse> {
  const body = defaultAssignee !== null ? { defaultAssignee } : {}
  const r =
    kind === 'sandbox'
      ? await channelsClient.whatsapp.managed.claim.$post({ json: body })
      : await channelsClient.whatsapp.managed.notification.claim.$post({ json: body })
  const payload = (await r.json()) as ClaimSuccessResponse | ClaimErrorResponse
  if (!r.ok) {
    const err = payload as ClaimErrorResponse
    if (err.error === 'pool_exhausted') {
      throw new Error(`All ${kind} numbers are currently in use. Ask the platform operator to expand the pool.`)
    }
    if (err.error === 'platform_not_configured') {
      throw new Error('Platform integration is not configured (missing VITE_PLATFORM_URL or HMAC secret).')
    }
    throw new Error(err.detail ?? err.error ?? `claim failed (${r.status})`)
  }
  return payload as ClaimSuccessResponse
}

interface ConnectManagedChannelDialogProps {
  open: boolean
  kind: ManagedChannelKind
  onOpenChange: (open: boolean) => void
  onConnected: (instanceId: string) => void
}

export function ConnectManagedChannelDialog({
  open,
  kind,
  onOpenChange,
  onConnected,
}: ConnectManagedChannelDialogProps) {
  const copy = KIND_COPY[kind]
  const agents = useAgentDefinitions()
  const enabledAgents = useMemo(() => (agents.data ?? []).filter((a) => a.enabled), [agents.data])

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  // Auto-pick the first enabled agent once the list loads. The operator can
  // still change it; we don't reset on subsequent renders so a manual pick
  // sticks across re-fetches.
  useEffect(() => {
    if (selectedAgentId === null && enabledAgents.length > 0) {
      setSelectedAgentId(enabledAgents[0].id)
    }
  }, [enabledAgents, selectedAgentId])

  const [softWarn, setSoftWarn] = useState<string | null>(null)

  const claim = useMutation({
    mutationFn: () => postClaim(kind, selectedAgentId),
    onSuccess: (data) => {
      if (data.webhook && data.webhook.ok === false) {
        setSoftWarn(
          `Number claimed, but webhook self-registration failed: ${data.webhook.detail}. Use "Re-verify" on the row once your public URL is reachable.`,
        )
        onConnected(data.instance.id)
        return
      }
      setSoftWarn(null)
      onConnected(data.instance.id)
      onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSoftWarn(null)
          claim.reset()
        }
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="connect-channel-agent">Assign to agent</Label>
            <Select
              value={selectedAgentId ?? ''}
              onValueChange={(v) => setSelectedAgentId(v === '' ? null : v)}
              disabled={agents.isLoading || enabledAgents.length === 0}
            >
              <SelectTrigger id="connect-channel-agent">
                <SelectValue
                  placeholder={
                    agents.isLoading
                      ? 'Loading agents…'
                      : enabledAgents.length === 0
                        ? 'No enabled agents yet'
                        : 'Pick an agent'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {enabledAgents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kind === 'notification' && (
              <p className="text-muted-foreground text-xs">
                Optional for notification channels — staff replies route via the default operator agent setting.
              </p>
            )}
          </div>
          {claim.isError && <p className="text-destructive text-xs">{claim.error.message}</p>}
          {softWarn && <p className="text-amber-600 text-xs dark:text-amber-400">{softWarn}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={claim.isPending}>
            Cancel
          </Button>
          <Button onClick={() => claim.mutate()} disabled={claim.isPending}>
            {claim.isPending ? 'Connecting…' : copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
