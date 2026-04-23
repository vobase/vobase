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
    <li className="px-5 py-4 space-y-2">
      {/* Tool info */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded bg-info/10 px-1.5 py-0.5 font-mono text-mini text-info">
              {approval.toolName}
            </span>
            <RelativeTimeCard date={approval.createdAt} className="text-mini text-muted-foreground" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground font-mono truncate max-w-md">
            conv: {approval.conversationId}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => handleDecide('approved')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              'bg-success/10 text-success hover:bg-success/20',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading === 'approved' ? '…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => handleDecide('rejected')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              'bg-destructive/10 text-destructive hover:bg-destructive/20',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading === 'rejected' ? '…' : 'Reject'}
          </button>
        </div>
      </div>

      {/* Tool args */}
      <details className="group">
        <summary className="cursor-pointer text-mini text-muted-foreground hover:text-foreground select-none">
          Tool args
        </summary>
        <pre className="mt-1.5 rounded bg-muted/50 px-2 py-1.5 text-mini overflow-auto max-h-32">
          {JSON.stringify(approval.toolArgs, null, 2)}
        </pre>
      </details>

      {error && <p className="text-mini text-destructive">{error}</p>}
    </li>
  )
}
