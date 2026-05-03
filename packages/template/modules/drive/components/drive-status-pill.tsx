/**
 * DriveStatusPill — small visual indicator for `extractionKind`. Used in the
 * file list when an upload is mid-pipeline. Pure-render: derives label,
 * tooltip, and color directly from the kind.
 *
 * `pending`     → warning + pulse animation ("indexing")
 * `extracted`   → success ("ready")
 * `binary-stub` → default + tooltip ("binary, request_caption to OCR")
 * `failed`      → error
 */

import { cn } from '@/lib/utils'
import type { DriveExtractionKind } from '../schema'

interface Pill {
  label: string
  className: string
  pulse: boolean
  title: string
}

const KIND_TO_PILL: Record<DriveExtractionKind, Pill> = {
  pending: {
    label: 'Indexing',
    className: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100',
    pulse: true,
    title: 'Drive is extracting and indexing this file (~5-30s).',
  },
  extracted: {
    label: 'Ready',
    className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
    pulse: false,
    title: 'Extraction complete — searchable.',
  },
  'binary-stub': {
    label: 'Binary',
    className: 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
    pulse: false,
    title: 'Binary asset — agent can request a caption / OCR (~30s).',
  },
  failed: {
    label: 'Failed',
    className: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
    pulse: false,
    title: 'Extraction failed — try `vobase drive reextract --id=...`.',
  },
}

export function DriveStatusPill({ kind, className }: { kind: DriveExtractionKind; className?: string }) {
  const pill = KIND_TO_PILL[kind] ?? KIND_TO_PILL.pending
  return (
    <span
      title={pill.title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs',
        pill.className,
        pill.pulse && 'animate-pulse',
        className,
      )}
    >
      {pill.label}
    </span>
  )
}
