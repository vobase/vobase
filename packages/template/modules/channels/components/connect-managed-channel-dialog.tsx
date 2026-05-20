/**
 * Minimal "Connect platform channel" dialog. Operators trigger it from the
 * placeholder row that the channels table renders for every managed kind
 * the org hasn't claimed yet. The dialog asks for one decision — which
 * agent should own incoming conversations on this channel — and then runs
 * the `claimAndBootstrap` sequence.
 */
import type { ManagedChannelKind } from '@modules/channels/managed/registry'
import { AssigneeBadge } from '@modules/messaging/components/assignee-badge'
import { usePrincipalDirectory } from '@modules/messaging/components/principal'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

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
}

async function postClaim(kind: ManagedChannelKind, defaultAssignee: string | null): Promise<ClaimSuccessResponse> {
  // `defaultAssignee` is the full assignee token (`agent:<id>` / `user:<id>`)
  // emitted by `AssigneeBadge`. Server stores it verbatim.
  const body = defaultAssignee !== null ? { defaultAssignee } : {}
  const r = await channelsClient.whatsapp.managed.claim.$post({ json: body })
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
  const { agents } = usePrincipalDirectory()

  // Full assignee token (`agent:<id>` / `user:<id>`) — same shape the inbox
  // emits, same shape `config.defaultAssignee` stores everywhere else.
  const [assignee, setAssignee] = useState<string | null>(null)
  // Auto-pick the first agent once the directory loads. Manual picks stick
  // across re-renders because we only fire on the null → first transition.
  useEffect(() => {
    if (assignee === null && agents.length > 0) {
      setAssignee(`agent:${agents[0].id}`)
    }
  }, [agents, assignee])

  const [softWarn, setSoftWarn] = useState<string | null>(null)

  const claim = useMutation({
    mutationFn: () => postClaim(kind, assignee),
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
            <Label>Default assignee</Label>
            <AssigneeBadge assignee={assignee} onSelect={(val) => setAssignee(val)} />
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
