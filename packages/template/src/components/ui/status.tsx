// shadcn-override-ok: hand-written CVA, no registry equivalent matches Status semantics
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

const statusVariants = cva('inline-flex items-center gap-2', {
  variants: {
    variant: {
      active:            'text-[var(--color-success)]',
      resolving:         'text-[var(--color-info)]',
      resolved:          'text-[var(--color-fg-subtle)]',
      compacted:         'text-[var(--color-fg-subtle)]',
      archived:          'text-[var(--color-fg-subtle)]',
      awaiting_approval: 'text-[var(--color-warning)]',
      failed:            'text-[var(--color-danger)]',
      success:           'text-[var(--color-success)]',
      error:             'text-[var(--color-danger)]',
      warning:           'text-[var(--color-warning)]',
      info:              'text-[var(--color-info)]',
      neutral:           'text-[var(--color-fg-muted)]',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

interface StatusProps extends VariantProps<typeof statusVariants> {
  label: string
  className?: string
}

function Status({ variant = 'neutral', label, className }: StatusProps) {
  return (
    <span className={cn(statusVariants({ variant }), className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="font-mono text-xs lowercase">{label}</span>
    </span>
  )
}

export { Status, statusVariants }
export type { StatusProps }
