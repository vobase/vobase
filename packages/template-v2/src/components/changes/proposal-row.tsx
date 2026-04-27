import type { ChangeProposalRow } from '@modules/changes/schema'
import { useState } from 'react'

import { RelativeTimeCard } from '@/components/ui/relative-time'
import { changesClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { DiffView } from './diff-view'

interface Props {
  proposal: ChangeProposalRow
  onDecided?: (id: string, decision: 'approved' | 'rejected') => void
}

export function ProposalRow({ proposal, onDecided }: Props) {
  const [loading, setLoading] = useState<'approved' | 'rejected' | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const decide = async (decision: 'approved' | 'rejected', note?: string) => {
    setLoading(decision)
    setError(null)
    try {
      const res = await changesClient.proposals[':id'].decide.$post({
        param: { id: proposal.id },
        json: { decision, decidedByUserId: 'staff:current', note },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string }
        throw new Error(body.error ?? 'Decision failed')
      }
      onDecided?.(proposal.id, decision)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(null)
      setShowRejectForm(false)
      setRejectNote('')
    }
  }

  const handleReject = async () => {
    if (!showRejectForm) {
      setShowRejectForm(true)
      return
    }
    await decide('rejected', rejectNote || undefined)
  }

  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 font-medium text-muted-foreground">
              {proposal.resourceModule}:{proposal.resourceType}
            </span>
            <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-muted-foreground">
              {proposal.resourceId}
            </span>
            <RelativeTimeCard date={proposal.createdAt} className="text-muted-foreground" />
            {proposal.confidence !== null && (
              <span className="text-muted-foreground">{Math.round(proposal.confidence * 100)}%</span>
            )}
          </div>

          {proposal.rationale && (
            <p className="text-muted-foreground text-xs italic leading-relaxed">{proposal.rationale}</p>
          )}

          <DiffView payload={proposal.payload} />
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => decide('approved')}
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
            onClick={handleReject}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium text-xs transition-colors',
              'bg-destructive/10 text-destructive hover:bg-destructive/20',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {loading === 'rejected' ? '…' : showRejectForm ? 'Confirm Reject' : 'Reject'}
          </button>
        </div>
      </div>

      {showRejectForm && (
        <div className="flex items-end gap-2">
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Reason for rejection (optional)"
            rows={2}
            className={cn(
              'flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs',
              'resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring',
            )}
          />
          <button
            type="button"
            onClick={() => {
              setShowRejectForm(false)
              setRejectNote('')
            }}
            className="px-2 py-1.5 text-muted-foreground text-xs hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}
    </li>
  )
}
