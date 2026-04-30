/**
 * Track-changes view for drive doc proposals — renders the proposed content
 * with insertions/deletions inline, in the visual style of Plate's suggestion
 * plugin (https://platejs.org/docs/suggestion). Insertions render as `<ins>`
 * with a green wash; deletions as `<del>` with a red strikethrough. The
 * before-content is fetched from the drive (scope=organization for now); when
 * the file doesn't exist yet, the entire proposal body is shown as a single
 * insertion so brand-new docs still read as suggestions.
 */

import { useDriveFile } from '@modules/drive/hooks/use-drive'
import { type Change, diffWords } from 'diff'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  /** Proposal payload — markdown_patch with a body and mode (replace/append). */
  payload: { kind: 'markdown_patch'; mode: 'replace' | 'append'; field: string; body: string }
  /** Drive path; used as the `resourceId` of the proposal (e.g. `/policies/refunds.md`). */
  resourceId: string
  className?: string
}

export function DriveSuggestionView({ payload, resourceId, className }: Props) {
  const beforeQuery = useDriveFile({ scope: 'organization' }, resourceId)
  const beforeContent = beforeQuery.data?.content ?? ''
  // `append` semantics: the proposal body is concatenated to the existing
  // content. `replace` swaps content out wholesale. Either way, the diff
  // between before and after is the visual story we want.
  const afterContent = payload.mode === 'append' ? `${beforeContent}${payload.body}` : payload.body

  const segments = useMemo<Change[]>(
    () =>
      beforeQuery.isLoading
        ? [{ value: payload.body, added: true, removed: false, count: 0 }]
        : diffWords(beforeContent, afterContent),
    [beforeContent, afterContent, payload.body, beforeQuery.isLoading],
  )

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const seg of segments) {
      if (seg.added) added += seg.value.length
      else if (seg.removed) removed += seg.value.length
    }
    return { added, removed }
  }, [segments])

  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      <div className="flex items-center gap-2 border-border border-b bg-muted/30 px-3 py-1.5 text-xs">
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-[10px] text-amber-700 uppercase tracking-wide dark:text-amber-300">
          {payload.mode}
        </span>
        <span className="font-mono text-muted-foreground">{resourceId}</span>
        <span className="ml-auto inline-flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-success/30" />+{stats.added}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-destructive/30" />−{stats.removed}
          </span>
        </span>
      </div>
      <div className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-foreground/90 text-sm leading-relaxed">
        {segments.map((seg, i) => {
          // Index keys are stable here: the segments array is regenerated as a
          // unit on every payload/before-content change, never spliced.
          const key = `seg-${i}`
          if (seg.added) {
            return (
              <ins key={key} className="rounded bg-success/15 px-0.5 text-success no-underline decoration-success/40">
                {seg.value}
              </ins>
            )
          }
          if (seg.removed) {
            return (
              <del key={key} className="rounded bg-destructive/15 px-0.5 text-destructive/80 decoration-destructive/40">
                {seg.value}
              </del>
            )
          }
          return <span key={key}>{seg.value}</span>
        })}
      </div>
    </div>
  )
}
