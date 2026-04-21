import type { LearningProposal } from '@modules/agents/schema'
import { useState } from 'react'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { cn } from '@/lib/utils'

const SCOPE_LABELS: Record<string, string> = {
  contact: 'Contact',
  agent_memory: 'Agent Memory',
  agent_skill: 'Agent Skill',
  drive_doc: 'Drive Doc',
}

const SCOPE_COLORS: Record<string, string> = {
  contact: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  agent_memory: 'bg-info/10 text-info border-info/20',
  agent_skill: 'bg-warning/10 text-warning border-warning/20',
  drive_doc: 'bg-success/10 text-success border-success/20',
}

interface Props {
  proposal: LearningProposal
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>
}

export function LearningProposalRow({ proposal, onDecide }: Props) {
  const [loading, setLoading] = useState<'approved' | 'rejected' | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setLoading('approved')
    setError(null)
    try {
      await onDecide(proposal.id, 'approved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(null)
    }
  }

  const handleReject = async () => {
    if (!showRejectForm) {
      setShowRejectForm(true)
      return
    }
    setLoading('rejected')
    setError(null)
    try {
      await onDecide(proposal.id, 'rejected', rejectNote || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(null)
      setShowRejectForm(false)
      setRejectNote('')
    }
  }

  const scopeColor = SCOPE_COLORS[proposal.scope] ?? 'bg-muted text-muted-foreground border-border'

  return (
    <li className="px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-mini font-medium', scopeColor)}
            >
              {SCOPE_LABELS[proposal.scope] ?? proposal.scope}
            </span>
            <span className="font-mono text-mini text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
              {proposal.target}
            </span>
            <RelativeTimeCard date={proposal.createdAt} className="text-mini text-muted-foreground" />
          </div>

          {proposal.body && <p className="text-xs text-foreground leading-relaxed line-clamp-3">{proposal.body}</p>}

          {proposal.rationale && <p className="text-mini text-muted-foreground italic">{proposal.rationale}</p>}

          {proposal.confidence !== null && (
            <div className="flex items-center gap-1.5">
              <span className="text-mini text-muted-foreground">Confidence:</span>
              <span className="text-mini font-medium">{Math.round((proposal.confidence ?? 0) * 100)}%</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={loading !== null}
            onClick={handleApprove}
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
            onClick={handleReject}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              'bg-destructive/10 text-destructive hover:bg-destructive/20',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading === 'rejected' ? '…' : showRejectForm ? 'Confirm Reject' : 'Reject'}
          </button>
        </div>
      </div>

      {showRejectForm && (
        <div className="flex gap-2 items-end">
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Reason for rejection (optional)"
            rows={2}
            className={cn(
              'flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs',
              'placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-1 focus:ring-ring',
            )}
          />
          <button
            type="button"
            onClick={() => {
              setShowRejectForm(false)
              setRejectNote('')
            }}
            className="text-mini text-muted-foreground hover:text-foreground px-2 py-1.5"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-mini text-destructive">{error}</p>}
    </li>
  )
}
