/**
 * Generic claim sheet for any platform-managed channel kind (sandbox,
 * notification, …). The `kind` prop pins which managed-channels registry
 * entry the sheet operates against. Each kind has its own pair of HTTP
 * routes on the tenant — sandbox under `whatsapp.managed.{availability,claim}`
 * and notification under `whatsapp.managed.notification.{availability,claim}`
 * — so `fetchAvailability` / `postClaim` switch on `kind` to pick the
 * right Hono RPC client path.
 *
 * Slice 3 introduces this generic — `ConnectNotificationSheet` was its
 * single-kind ancestor.
 */
import type { ManagedChannelKind } from '@modules/channels/managed/registry'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Status } from '@/components/ui/status'
import { channelsClient } from '@/lib/api-client'

interface AvailabilityResponse {
  /** Free slots in the platform pool for this kind. Normalised across kinds. */
  available: number
  configured: boolean
  error?: string
}

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

interface KindCopy {
  title: string
  description: string
  ctaIdle: string
  ctaPending: string
  exhaustedMessage: string
}

const KIND_COPY: Record<ManagedChannelKind, KindCopy> = {
  sandbox: {
    title: 'Connect sandbox number',
    description:
      'Claim a platform-managed WhatsApp sandbox number for testing customer-tier flows before bringing your own number.',
    ctaIdle: 'Claim sandbox number',
    ctaPending: 'Claiming…',
    exhaustedMessage: 'All sandbox numbers are currently in use. Ask the platform operator to expand the pool.',
  },
  notification: {
    title: 'Connect notification number',
    description:
      'Claim a platform-managed WhatsApp number used exclusively for staff notifications. Staff members can link their personal phone in their profile to receive mention pings here.',
    ctaIdle: 'Claim notification number',
    ctaPending: 'Claiming…',
    exhaustedMessage: 'All notification numbers are currently in use. Ask the platform operator to expand the pool.',
  },
}

async function fetchAvailability(kind: ManagedChannelKind): Promise<AvailabilityResponse> {
  // Server returns kind-specific field names (`sandboxPoolAvailable` vs
  // `notificationPoolAvailable`); normalise to `available` here.
  if (kind === 'sandbox') {
    const r = await channelsClient.whatsapp.managed.availability.$get()
    if (!r.ok && r.status !== 502) throw new Error(`availability failed (${r.status})`)
    const body = (await r.json()) as { sandboxPoolAvailable?: number; configured?: boolean; error?: string }
    return {
      available: body.sandboxPoolAvailable ?? 0,
      configured: body.configured ?? false,
      error: body.error,
    }
  }
  const r = await channelsClient.whatsapp.managed.notification.availability.$get()
  if (!r.ok && r.status !== 502) throw new Error(`availability failed (${r.status})`)
  const body = (await r.json()) as { notificationPoolAvailable?: number; configured?: boolean; error?: string }
  return {
    available: body.notificationPoolAvailable ?? 0,
    configured: body.configured ?? false,
    error: body.error,
  }
}

async function postClaim(kind: ManagedChannelKind): Promise<ClaimSuccessResponse> {
  const r =
    kind === 'sandbox'
      ? await channelsClient.whatsapp.managed.claim.$post()
      : await channelsClient.whatsapp.managed.notification.claim.$post()
  const body = (await r.json()) as ClaimSuccessResponse | ClaimErrorResponse
  if (!r.ok) {
    const err = body as ClaimErrorResponse
    const copy = KIND_COPY[kind]
    if (err.error === 'pool_exhausted') throw new Error(copy.exhaustedMessage)
    if (err.error === 'platform_not_configured') {
      throw new Error('Platform integration is not configured (missing VITE_PLATFORM_URL or HMAC secret).')
    }
    throw new Error(err.detail ?? err.error ?? `claim failed (${r.status})`)
  }
  return body as ClaimSuccessResponse
}

/** Pick the Status indicator variant for a pool availability snapshot. */
function statusVariant(available: number, configured: boolean): 'success' | 'warning' {
  if (!configured) return 'warning'
  return available > 0 ? 'success' : 'warning'
}

interface ConnectManagedChannelSheetProps {
  open: boolean
  kind: ManagedChannelKind
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function ConnectManagedChannelSheet({ open, kind, onOpenChange, onConnected }: ConnectManagedChannelSheetProps) {
  const copy = KIND_COPY[kind]

  const availability = useQuery({
    queryKey: ['channels', 'managed', kind, 'availability'],
    queryFn: () => fetchAvailability(kind),
    staleTime: 30_000,
    enabled: open,
  })

  const [softWarn, setSoftWarn] = useState<string | null>(null)

  const claim = useMutation({
    mutationFn: () => postClaim(kind),
    onSuccess: (data) => {
      if (data.webhook && data.webhook.ok === false) {
        setSoftWarn(
          `Number claimed, but webhook self-registration failed: ${data.webhook.detail}. Use "Re-verify" once your public URL is reachable.`,
        )
        onConnected()
        return
      }
      setSoftWarn(null)
      onConnected()
      onOpenChange(false)
    },
  })

  const configured = availability.data?.configured ?? false
  const available = availability.data?.available ?? 0

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSoftWarn(null)
          claim.reset()
        }
        onOpenChange(o)
      }}
    >
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {availability.isLoading && <Status variant="info" label="Checking pool availability…" />}
          {availability.data && (
            <Status
              variant={statusVariant(available, configured)}
              label={
                !configured
                  ? 'Platform integration not configured'
                  : available > 0
                    ? `${available} number${available === 1 ? '' : 's'} available`
                    : 'No numbers free'
              }
            />
          )}
          {availability.data?.error && (
            <p className="text-destructive text-xs">Platform error: {availability.data.error}</p>
          )}
          {claim.isError && <p className="text-destructive text-xs">{claim.error.message}</p>}
          {softWarn && <p className="text-amber-600 text-xs dark:text-amber-400">{softWarn}</p>}
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={claim.isPending}>
            Cancel
          </Button>
          <Button onClick={() => claim.mutate()} disabled={claim.isPending || !configured}>
            {claim.isPending ? copy.ctaPending : copy.ctaIdle}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
