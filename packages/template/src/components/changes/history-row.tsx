import { diffFileName, getHeadlineParts } from '@modules/changes/lib/humanize'
import type { ChangeStatus } from '@modules/changes/schema'
import type { ChangeProposalHistoryItem } from '@modules/changes/service/proposals'
import { Link } from '@tanstack/react-router'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { useMemo } from 'react'

import { Principal, usePrincipalDirectory } from '@/components/principal'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { Status } from '@/components/ui/status'
import { cn } from '@/lib/utils'
import { DiffView } from './diff-view'
import { DriveSuggestionView } from './drive-suggestion-view'
import { HeadlineTarget } from './headline-target'
import { ProsePanel } from './prose-panel'
import { useHighlightRow } from './use-highlight-row'

interface Props {
  proposal: ChangeProposalHistoryItem
  highlight?: boolean
}

const STATUS_VARIANT: Record<ChangeStatus, { variant: 'success' | 'error' | 'info' | 'neutral'; label: string }> = {
  pending: { variant: 'info', label: 'Pending' },
  approved: { variant: 'success', label: 'Approved' },
  rejected: { variant: 'error', label: 'Rejected' },
  auto_written: { variant: 'info', label: 'Auto-applied' },
  superseded: { variant: 'neutral', label: 'Superseded' },
}

export function HistoryRow({ proposal, highlight = false }: Props) {
  const directory = usePrincipalDirectory()
  const headlineParts = useMemo(() => getHeadlineParts(proposal), [proposal])
  const statusInfo = STATUS_VARIANT[proposal.status]
  const ts = proposal.decidedAt ?? proposal.createdAt
  const { rowRef, detailsOpen, onDetailsToggle } = useHighlightRow<HTMLLIElement>(highlight)

  return (
    <li ref={rowRef} className="rounded-lg border border-border bg-card shadow-sm">
      <details className="group" open={detailsOpen} onToggle={onDetailsToggle}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted/30">
          <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <Status variant={statusInfo.variant} label={statusInfo.label} className="shrink-0" />
          <Principal id={proposal.proposedById} variant="inline" directory={directory} className="text-foreground" />
          <span className="text-muted-foreground text-sm">→</span>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
            <HeadlineTarget parts={headlineParts} directory={directory} />
          </div>
          {proposal.decidedByUserId && (
            <>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">by</span>
              <Principal
                id={proposal.decidedByUserId}
                variant="inline"
                directory={directory}
                className="shrink-0 text-foreground text-xs"
              />
            </>
          )}
          <RelativeTimeCard
            date={ts}
            className={cn('shrink-0 text-muted-foreground text-xs', !proposal.decidedByUserId && 'ml-auto')}
          />
        </summary>

        <div className="space-y-4 border-border/40 border-t px-4 py-4">
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

          {proposal.resourceModule === 'drive' &&
          proposal.resourceType === 'doc' &&
          proposal.payload.kind === 'markdown_patch' ? (
            <DriveSuggestionView payload={proposal.payload} resourceId={proposal.resourceId} />
          ) : (
            <DiffView
              payload={proposal.payload}
              fileName={
                proposal.payload.kind === 'markdown_patch' ? diffFileName(proposal, proposal.payload.field) : undefined
              }
            />
          )}

          {proposal.decidedNote && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div className="mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
                Decision note
              </div>
              <p className="whitespace-pre-line text-foreground/90">{proposal.decidedNote}</p>
            </div>
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
            <span className="font-mono opacity-70">{proposal.resourceId}</span>
          </div>
        </div>
      </details>
    </li>
  )
}
