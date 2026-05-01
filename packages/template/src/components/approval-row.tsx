import type { DecideParams } from '@modules/messaging/pages/approvals'
import type { PendingApproval } from '@modules/messaging/schema'
import { useState } from 'react'

import { RelativeTimeCard } from '@/components/ui/relative-time'
import { cn } from '@/lib/utils'

interface Props {
  approval: PendingApproval
  onDecide: (params: DecideParams) => Promise<void>
}

export function ApprovalRow({ approval, onDecide }: Props) {
  const [loading, setLoading] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDecide = async (decision: 'approved' | 'rejected') => {
    setLoading(decision)
    setError(null)
    try {
      await onDecide({ id: approval.id, decision })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(null)
    }
  }

  return (
    <li className="space-y-2 px-5 py-4">
      {/* Tool info */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded bg-info/10 px-1.5 py-0.5 font-mono text-info text-xs">
              {approval.toolName}
            </span>
            <RelativeTimeCard date={approval.createdAt} className="text-muted-foreground text-xs" />
          </div>
          <p className="mt-1 max-w-md truncate font-mono text-muted-foreground text-xs">
            conv: {approval.conversationId}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => handleDecide('approved')}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium text-xs transition-colors',
              'bg-success/10 text-success hover:bg-success/20',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {loading === 'approved' ? '…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => handleDecide('rejected')}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium text-xs transition-colors',
              'bg-destructive/10 text-destructive hover:bg-destructive/20',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {loading === 'rejected' ? '…' : 'Reject'}
          </button>
        </div>
      </div>

      {/* Tool args */}
      <details className="group">
        <summary className="cursor-pointer select-none text-muted-foreground text-xs hover:text-foreground">
          Tool args
        </summary>
        <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-muted/50 px-2 py-1.5 text-xs">
          {JSON.stringify(approval.toolArgs, null, 2)}
        </pre>
      </details>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </li>
  )
}
