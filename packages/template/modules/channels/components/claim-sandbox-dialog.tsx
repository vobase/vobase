/**
 * Click-driven sandbox claim dialog.
 *
 * Replaces the legacy `PLATFORM_AUTO_BOOTSTRAP=true` boot hook. The user opens
 * this from the "Add channel" dropdown and clicks one button — the same
 * handshake + vault store + `channel_instances` upsert + webhook self-register
 * sequence runs synchronously inside the request, with the result reported
 * back to the UI (success | already-claimed | pool-exhausted | webhook-soft-failed).
 *
 * No "list available channels and pick one" picker — the platform sandbox pool
 * slots are interchangeable shared phones (same WABA, same Meta app), so a
 * picker would be theatre. The pool capacity badge sets the user's expectation
 * before they click.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Status } from '@/components/ui/status'
import { channelsClient } from '@/lib/api-client'
import type { ChannelInstanceRow } from './channels-table'

interface AvailabilityResponse {
  sandboxPoolAvailable: number
  configured: boolean
  error?: string
}

interface ClaimSuccessResponse {
  status: 'claimed' | 'already_claimed'
  instance: ChannelInstanceRow
  webhook?: { ok: true; registeredAt: string } | { ok: false; detail: string }
}

interface ClaimErrorResponse {
  error: string
  detail?: string
  code?: string | null
}

async function fetchAvailability(): Promise<AvailabilityResponse> {
  const r = await channelsClient.whatsapp.managed.availability.$get()
  if (!r.ok && r.status !== 502) throw new Error(`availability failed (${r.status})`)
  return (await r.json()) as AvailabilityResponse
}

async function postClaim(): Promise<ClaimSuccessResponse> {
  const r = await channelsClient.whatsapp.managed.claim.$post()
  const body = (await r.json()) as ClaimSuccessResponse | ClaimErrorResponse
  if (!r.ok) {
    const err = body as ClaimErrorResponse
    if (err.error === 'pool_exhausted') {
      throw new Error('All sandbox numbers are currently in use. Ask the platform operator to expand the pool.')
    }
    if (err.error === 'platform_not_configured') {
      throw new Error('Platform integration is not configured (missing VITE_PLATFORM_URL or HMAC secret).')
    }
    throw new Error(err.detail ?? err.error ?? `claim failed (${r.status})`)
  }
  return body as ClaimSuccessResponse
}

interface ClaimSandboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClaimed: (instanceId: string) => void
}

export function ClaimSandboxDialog({ open, onOpenChange, onClaimed }: ClaimSandboxDialogProps) {
  const availability = useQuery({
    queryKey: ['channels', 'managed', 'availability'],
    queryFn: fetchAvailability,
    staleTime: 30_000,
    enabled: open,
  })

  const [softWarn, setSoftWarn] = useState<string | null>(null)
  const claim = useMutation({
    mutationFn: postClaim,
    onSuccess: (data) => {
      if (data.webhook && data.webhook.ok === false) {
        setSoftWarn(
          `Sandbox claimed, but the webhook self-registration failed: ${data.webhook.detail}. Use the "Re-verify" action on the row once your public URL is reachable.`,
        )
        // Still propagate so the parent can refresh the table; user dismisses
        // the dialog manually after reading the warning.
        onClaimed(data.instance.id)
        return
      }
      setSoftWarn(null)
      onClaimed(data.instance.id)
      onOpenChange(false)
    },
  })

  const available = availability.data?.sandboxPoolAvailable ?? 0
  const configured = availability.data?.configured ?? false
  const canClaim = configured && (available > 0 || availability.isLoading)

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
          <DialogTitle>Claim a platform sandbox number</DialogTitle>
          <DialogDescription>
            The platform allocates one shared WhatsApp sandbox phone to your tenant. Customers reach you by sending{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/link {'<slug>'}</code> to that number
            first, then start chatting normally.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {availability.isLoading && <Status variant="info" label="Checking pool availability…" />}
          {availability.data && (
            <Status
              variant={!configured ? 'warning' : available > 0 ? 'success' : 'warning'}
              label={
                !configured
                  ? 'Platform integration not configured'
                  : available > 0
                    ? `${available} sandbox number${available === 1 ? '' : 's'} available`
                    : 'No sandbox numbers free'
              }
            />
          )}
          {availability.data?.error && (
            <p className="text-destructive text-xs">Platform error: {availability.data.error}</p>
          )}
          {claim.isError && <p className="text-destructive text-xs">{claim.error.message}</p>}
          {softWarn && <p className="text-warning text-xs">{softWarn}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={claim.isPending}>
            Cancel
          </Button>
          <Button onClick={() => claim.mutate()} disabled={claim.isPending || !canClaim}>
            {claim.isPending ? 'Claiming…' : 'Claim sandbox number'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
