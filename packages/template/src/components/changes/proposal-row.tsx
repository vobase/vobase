import { getHeadlineParts, type HeadlineParts } from '@modules/changes/lib/humanize'
import type { ChangeProposalInboxItem } from '@modules/changes/schema'
import { MessageThread } from '@modules/messaging/components/message-thread'
import { useMessages } from '@modules/messaging/hooks/use-messages'
import { useNotes } from '@modules/messaging/hooks/use-notes'
import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, MessageSquare, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'

import { Principal, type PrincipalDirectory, usePrincipalDirectory } from '@/components/principal'
import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { useCurrentUserId } from '@/hooks/use-current-user'
import { changesClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { DiffView } from './diff-view'
import { DriveSuggestionView } from './drive-suggestion-view'

/**
 * Renders the resource portion of the headline, swapping a static
 * "Module Type: id" label for a context-aware sentence based on
 * `getHeadlineParts`. Memory edits collapse to "<owner>'s Memory", contact
 * edits collapse to just the contact's name, drive docs render as
 * "Document: <basename>". Owner avatar is always shown for owned resources.
 *
 * Used inside the collapsed "technical details" disclosure — the SME-facing
 * top half is intentionally just rationale + outcome prose.
 */
function HeadlineTarget({ parts, directory }: { parts: HeadlineParts; directory: PrincipalDirectory }) {
  if (parts.kind === 'principal') {
    return <Principal id={parts.principalToken} variant="inline" directory={directory} className="text-foreground" />
  }
  if (parts.kind === 'owned-resource') {
    return (
      <>
        <Principal id={parts.ownerToken} variant="inline" directory={directory} className="text-foreground" />
        <span className="text-muted-foreground">{"'s"}</span>
        <span className="font-semibold">{parts.ownerLabel}</span>
        {parts.resourceName && (
          <>
            <span className="text-muted-foreground">:</span>
            <span className="font-mono text-foreground/90 text-sm">{parts.resourceName}</span>
          </>
        )}
      </>
    )
  }
  return (
    <>
      <span className="font-semibold">{parts.kindLabel}:</span>
      <span className="font-mono text-foreground/90 text-sm">{parts.resourceName}</span>
    </>
  )
}

interface Props {
  proposal: ChangeProposalInboxItem
  onDecided?: () => void
}

const CONFIDENCE_TIERS: Array<{ min: number; cls: string }> = [
  { min: 80, cls: 'text-success' },
  { min: 50, cls: 'text-warning' },
  { min: 0, cls: 'text-destructive' },
]

function confidenceTone(pct: number): string {
  return CONFIDENCE_TIERS.find((t) => pct >= t.min)?.cls ?? CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1]?.cls
}

/**
 * Two-up prose panel for the proposer's "Problem" + "After approval" copy.
 * The whole `/changes` page is built around these two prose blocks — every
 * engineer-facing detail (resource type, diff, conversation, confidence)
 * sits behind a disclosure. SMEs read what's wrong and what fixes it; if
 * they want the technical guts, they expand.
 */
function ProsePanel({ label, tone, children }: { label: string; tone: 'amber' | 'success'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3',
        tone === 'amber' && 'border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/25',
        tone === 'success' && 'border-success/30 bg-success/5',
      )}
    >
      <div
        className={cn(
          'mb-1.5 font-semibold text-[10px] uppercase tracking-wide',
          tone === 'amber' && 'text-amber-800 dark:text-amber-300',
          tone === 'success' && 'text-success',
        )}
      >
        {label}
      </div>
      <p className="whitespace-pre-line text-foreground text-sm leading-relaxed">{children}</p>
    </div>
  )
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

  const directory = usePrincipalDirectory()
  const headlineParts = useMemo(() => getHeadlineParts(proposal), [proposal])
  const confidencePct = proposal.confidence !== null ? Math.round(proposal.confidence * 100) : null

  return (
    <li className="rounded-lg bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="space-y-4 p-5">
        {/* Subtle proposer line — engineer-y target/resource lives behind the
            disclosure below; SMEs only need to know "Sentinel proposed
            something" plus the problem/outcome prose. */}
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
          <Principal id={proposal.proposedById} variant="inline" directory={directory} className="text-foreground" />
          <span>proposes a change</span>
          <RelativeTimeCard date={proposal.createdAt} className="ml-auto" />
        </div>

        {/* Two-row WYSIWYG payload — both written by the proposer. Hidden if
            null so the row stays clean instead of showing placeholder copy. */}
        {proposal.rationale && (
          <ProsePanel label="Problem" tone="amber">
            {proposal.rationale}
          </ProsePanel>
        )}
        {proposal.expectedOutcome && (
          <ProsePanel label="Outcome" tone="success">
            {proposal.expectedOutcome}
          </ProsePanel>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <p className="mr-auto text-destructive text-sm">{error}</p>}
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
            {loading === 'approved' ? 'Approving…' : 'Approve change'}
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

        {/* Collapsed technical detail — target, diff, conversation context,
            metadata. SMEs never need to expand this; advanced operators can.
            Native <details> beats Radix Collapsible here: zero JS, free
            keyboard accessibility, persists open state across rerenders. */}
        <details className="group border-border/40 border-t pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
            Show technical details
          </summary>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm">
              <span className="text-muted-foreground">Target:</span>
              <HeadlineTarget parts={headlineParts} directory={directory} />
            </div>

            {proposal.resourceModule === 'drive' &&
            proposal.resourceType === 'doc' &&
            proposal.payload.kind === 'markdown_patch' ? (
              <DriveSuggestionView payload={proposal.payload} resourceId={proposal.resourceId} />
            ) : (
              <DiffView payload={proposal.payload} resourceLabel={proposal.resourceId} />
            )}

            {proposal.conversationId && (
              <ConversationContextSnippet conversationId={proposal.conversationId} anchorAt={proposal.createdAt} />
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {proposal.conversationId && proposal.conversationContactId && (
                <Link
                  to="/inbox/$contactId"
                  params={{ contactId: proposal.conversationContactId }}
                  search={{ conv: proposal.conversationId }}
                  className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
                >
                  <MessageSquare className="size-3" />
                  <span>open conversation</span>
                </Link>
              )}
              <span className="font-mono">
                {proposal.resourceModule} · {proposal.resourceType}
              </span>
              {confidencePct !== null && (
                <span className={cn('inline-flex items-center gap-1', confidenceTone(confidencePct))}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {confidencePct}% confidence
                </span>
              )}
              <span className="font-mono opacity-70">{proposal.resourceId}</span>
            </div>
          </div>
        </details>
      </div>
    </li>
  )
}

const CONTEXT_WINDOW_BEFORE = 4
const CONTEXT_WINDOW_AFTER = 1

/**
 * Compact thread snippet showing what the conversation looked like around the
 * time the proposal was created — last few messages before the trigger plus
 * any inline note that pinged the agent. Reuses `MessageThread` for visual
 * parity with the inbox detail view; the fixed-height wrapper turns the
 * StickToBottom container into a static panel.
 */
function ConversationContextSnippet({ conversationId, anchorAt }: { conversationId: string; anchorAt: Date }) {
  const { data: messages = [] } = useMessages(conversationId, 50)
  const { data: notes = [] } = useNotes(conversationId)
  const currentUserId = useCurrentUserId()

  const { windowMessages, windowNotes } = useMemo(() => {
    const anchor = anchorAt.getTime()
    const sortedMessages = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    const before = sortedMessages.filter((m) => new Date(m.createdAt).getTime() <= anchor)
    const after = sortedMessages.filter((m) => new Date(m.createdAt).getTime() > anchor)
    const windowed = [...before.slice(-CONTEXT_WINDOW_BEFORE), ...after.slice(0, CONTEXT_WINDOW_AFTER)]
    const earliest = windowed[0] ? new Date(windowed[0].createdAt).getTime() : anchor
    const latest = windowed[windowed.length - 1] ? new Date(windowed[windowed.length - 1].createdAt).getTime() : anchor
    const noteWindow = notes.filter((n) => {
      const t = new Date(n.createdAt).getTime()
      return t >= earliest && t <= latest
    })
    return { windowMessages: windowed, windowNotes: noteWindow }
  }, [messages, notes, anchorAt])

  if (windowMessages.length === 0 && windowNotes.length === 0) return null

  return (
    <div className="flex h-80 flex-col overflow-hidden rounded-md border border-border/60 bg-muted/15">
      <div className="shrink-0 border-border/60 border-b px-3 py-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
        Conversation context
      </div>
      {/* Fixed-height column → MessageThread's StickToBottom can compute a
          scrollable viewport and auto-pin to bottom on mount. */}
      <MessageThread messages={windowMessages} notes={windowNotes} currentUserId={currentUserId} />
    </div>
  )
}
