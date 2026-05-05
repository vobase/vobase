import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Two-up prose panel for proposer-authored "Problem" + "After approval" copy.
 * The whole `/changes` page is built around these two prose blocks; engineer
 * details live behind disclosures. Tone selects amber (problem) or success
 * (outcome) styling.
 */
export function ProsePanel({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'amber' | 'success'
  children: ReactNode
}) {
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
