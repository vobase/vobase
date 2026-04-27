import { summarizePayload } from '@modules/changes/lib/summarize-payload'
import type { ChangeProposalRow } from '@modules/changes/schema'
import { Check, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { changesClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { DiffView } from './diff-view'

interface Props {
  proposal: ChangeProposalRow
  onDecided?: () => void
}

const MODULE_TONE = {
  agents: 'bg-violet-500/10 text-violet-500',
  contacts: 'bg-blue-500/10 text-blue-500',
  drive: 'bg-amber-500/10 text-amber-500',
  messaging: 'bg-emerald-500/10 text-emerald-500',
} as const
type KnownModule = keyof typeof MODULE_TONE
const FALLBACK_TONE = 'bg-muted text-muted-foreground'

const CONFIDENCE_TIERS: Array<{ min: number; cls: string }> = [
  { min: 80, cls: 'bg-success/10 text-success' },
  { min: 50, cls: 'bg-warning/10 text-warning' },
  { min: 0, cls: 'bg-destructive/10 text-destructive' },
]

function confidenceTone(pct: number): string {
  return CONFIDENCE_TIERS.find((t) => pct >= t.min)?.cls ?? CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1]?.cls
}

function moduleTone(name: string): string {
  return name in MODULE_TONE ? MODULE_TONE[name as KnownModule] : FALLBACK_TONE
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
      onDecided?.()
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

  const summary = useMemo(() => summarizePayload(proposal.payload), [proposal.payload])
  const confidencePct = proposal.confidence !== null ? Math.round(proposal.confidence * 100) : null

  return (
    <li className="rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide',
              moduleTone(proposal.resourceModule),
            )}
          >
            {proposal.resourceModule} · {proposal.resourceType}
          </span>
          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-muted-foreground">
            {proposal.resourceId}
          </span>
          {confidencePct !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium',
                confidenceTone(confidencePct),
              )}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {confidencePct}% confidence
            </span>
          )}
          <RelativeTimeCard date={proposal.createdAt} className="ml-auto text-muted-foreground" />
        </div>

        <div className="space-y-1.5">
          <p className="font-medium text-base text-foreground leading-snug">{summary}</p>
          {proposal.rationale && (
            <p className="border-primary/40 border-l-2 pl-3 text-muted-foreground text-sm leading-relaxed">
              {proposal.rationale}
            </p>
          )}
        </div>

        <DiffView payload={proposal.payload} resourceLabel={proposal.resourceId} />

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {error && <p className="mr-auto text-destructive text-xs">{error}</p>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading !== null}
            onClick={handleReject}
            className="gap-1.5"
          >
            <X className="size-3.5" />
            {loading === 'rejected' ? 'Rejecting…' : showRejectForm ? 'Confirm reject' : 'Reject'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading !== null}
            onClick={() => decide('approved')}
            className="gap-1.5"
          >
            <Check className="size-3.5" />
            {loading === 'approved' ? 'Approving…' : 'Approve'}
          </Button>
        </div>

        {showRejectForm && (
          <div className="flex items-end gap-2 border-border border-t pt-3">
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={2}
              className={cn(
                'flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm',
                'resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring',
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowRejectForm(false)
                setRejectNote('')
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
