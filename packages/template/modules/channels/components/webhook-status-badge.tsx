import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useReVerifyWebhook, useWebhookStatus } from '../hooks/use-webhook-status'

interface WebhookStatusBadgeProps {
  instanceId: string
}

/**
 * Compact webhook-registration status indicator for managed-WhatsApp rows.
 *
 * - ✓ verified Xm ago  → all good (green)
 * - ! failed: <reason> → most recent challenge or forward failed (red)
 * - ⋯ pending          → registered but never verified (amber)
 *
 * Hover surfaces the full webhook URL + last error. Adjacent re-verify icon
 * button re-runs the platform challenge — useful when the operator just
 * rotated the public URL or wants a fresh timestamp.
 */
export function WebhookStatusBadge({ instanceId }: WebhookStatusBadgeProps) {
  const { data: status, isLoading } = useWebhookStatus(instanceId)
  const reverify = useReVerifyWebhook(instanceId)

  if (isLoading || !status) return null

  const variant = status.lastVerifyStatus === 'ok' ? 'ok' : status.lastVerifyStatus === 'failed' ? 'failed' : 'pending'

  const badge = (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-xs ${
        variant === 'ok'
          ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200'
          : variant === 'failed'
            ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200'
            : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      }`}
    >
      {variant === 'ok' ? (
        <CheckCircle2 className="size-3" />
      ) : variant === 'failed' ? (
        <AlertCircle className="size-3" />
      ) : (
        <Loader2 className="size-3 animate-spin" />
      )}
      {variant === 'ok' && status.lastVerifiedAt ? (
        <>
          Webhook <RelativeTimeCard date={new Date(status.lastVerifiedAt)} length="short" />
        </>
      ) : variant === 'failed' ? (
        <>Webhook failed</>
      ) : (
        <>Webhook pending</>
      )}
    </span>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <span className="inline-flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{badge}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1 text-xs">
              <div className="break-all font-mono">{status.webhookUrl}</div>
              {status.lastVerifyError && <div className="text-destructive">Error: {status.lastVerifyError}</div>}
              <div className="text-muted-foreground">
                Registered <RelativeTimeCard date={new Date(status.registeredAt)} length="short" />
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => reverify.mutate()}
          disabled={reverify.isPending}
          aria-label="Re-verify webhook URL"
          title={reverify.isPending ? 'Re-verifying…' : 'Re-verify webhook URL'}
        >
          <RefreshCw className={`size-3 ${reverify.isPending ? 'animate-spin' : ''}`} />
        </Button>
      </span>
    </TooltipProvider>
  )
}
