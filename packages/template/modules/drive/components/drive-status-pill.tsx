/**
 * DriveStatusPill — small visual indicator for `extractionKind`. Used in the
 * file list when an upload is mid-pipeline.
 *
 * `pending`     → warning + pulse animation ("indexing")
 * `extracted`   → success ("ready") — typically not rendered
 * `binary-stub` → default + tooltip ("binary, request_caption to OCR")
 * `failed`      → error + tooltip carrying the row's `processingError` so the
 *                 user can see WHY without paging through server logs (e.g.
 *                 `extract_failed: <pdfium message>`,
 *                 `embedding_unavailable: <provider message>`,
 *                 `org_daily_budget_exceeded`).
 */

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DriveExtractionKind } from '../schema'

interface PillStyle {
  label: string
  className: string
  pulse: boolean
  hint: string
}

const KIND_TO_PILL: Record<DriveExtractionKind, PillStyle> = {
  pending: {
    label: 'Indexing',
    className: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100',
    pulse: true,
    hint: 'Drive is extracting and indexing this file (~5-30s).',
  },
  extracted: {
    label: 'Ready',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
    pulse: false,
    hint: 'Extraction complete — searchable.',
  },
  'binary-stub': {
    label: 'Binary',
    className: 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
    pulse: false,
    hint: 'Binary asset — agent can request a caption / OCR (~30s).',
  },
  failed: {
    label: 'Failed',
    className: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
    pulse: false,
    hint: 'Extraction failed. Try `vobase drive reextract --id=...` once the underlying issue is resolved.',
  },
}

export function DriveStatusPill({
  kind,
  error,
  className,
}: {
  kind: DriveExtractionKind
  error?: string | null
  className?: string
}) {
  const pill = KIND_TO_PILL[kind] ?? KIND_TO_PILL.pending
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs',
            pill.className,
            pill.pulse && 'animate-pulse',
            className,
          )}
        >
          {pill.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm space-y-1.5">
        {error ? (
          <>
            <div className="break-all rounded bg-foreground/10 px-1.5 py-1 font-mono text-[11px]">{error}</div>
            <div className="text-[11px] opacity-80">{pill.hint}</div>
          </>
        ) : (
          <div className="text-[11px]">{pill.hint}</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
