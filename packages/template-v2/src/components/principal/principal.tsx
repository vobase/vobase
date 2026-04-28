/**
 * Universal principal renderer.
 *
 *   <Principal id="agent:abc"   variant="simple"  />  →  "Sentinel"
 *   <Principal id="staff:usr0"  variant="mention" />  →  "@Alice"  (pill)
 *   <Principal id="contact:c1"  variant="inbox"   />  →  [avatar] Carl Tan
 *                                                       Contact · carl@…
 *
 * `id` is the canonical `kind:id` token (matches `change_history.changedBy`,
 * conversation assignees, note `mentions[]`). Always wraps a HoverCard with
 * full identity + kind-specific detail unless `noHover` is set.
 *
 * Color convention: purple agent · blue staff · green contact.
 */

import type React from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'
import { PrincipalAvatar } from './avatar'
import { type PrincipalDirectory, type PrincipalKind, type PrincipalRecord, usePrincipalDirectory } from './directory'
import { PrincipalHoverCard } from './hover-card'

export type PrincipalVariant = 'simple' | 'mention' | 'inbox'

export interface PrincipalProps {
  /** Canonical `kind:id` token, e.g. `agent:abc`, `staff:usr0`, `contact:c1`. */
  id: string
  variant?: PrincipalVariant
  /** Used when the directory hasn't resolved yet. */
  fallbackName?: string
  /** Suppress the hovercard wrapper (dense lists, nested hovercards). */
  noHover?: boolean
  /** Highlight pill (mention variant only) — used for "you were mentioned". */
  highlight?: boolean
  className?: string
  /** Reuse a directory from the parent to avoid duplicate hook subscriptions. */
  directory?: PrincipalDirectory
}

export function Principal({
  id,
  variant = 'simple',
  fallbackName,
  noHover = false,
  highlight = false,
  className,
  directory: directoryProp,
}: PrincipalProps) {
  const own = usePrincipalDirectory()
  const directory = directoryProp ?? own
  const record = directory.resolve(id)
  const display = record?.name ?? fallbackName ?? formatTokenFallback(id)
  const kind: PrincipalKind = record?.kind ?? guessKind(id)

  const body = renderBody({ variant, record, display, kind, highlight, className })
  if (noHover || !record) return body

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{body}</HoverCardTrigger>
      <HoverCardContent className="w-72 p-0">
        <PrincipalHoverCard record={record} />
      </HoverCardContent>
    </HoverCard>
  )
}

function renderBody({
  variant,
  record,
  display,
  kind,
  highlight,
  className,
}: {
  variant: PrincipalVariant
  record: PrincipalRecord | null
  display: string
  kind: PrincipalKind
  highlight: boolean
  className: string | undefined
}): React.ReactElement {
  if (variant === 'mention') {
    return (
      <span
        className={cn(
          'inline-flex cursor-default items-center rounded px-1 font-medium text-sm leading-tight',
          highlight ? MENTION_HIGHLIGHT : MENTION_PILL[kind],
          className,
        )}
      >
        @{display}
      </span>
    )
  }
  if (variant === 'inbox') {
    return (
      <span className={cn('inline-flex cursor-default items-center gap-2', className)}>
        <PrincipalAvatar kind={kind} size="md" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium text-foreground text-sm">{display}</span>
          <span className="truncate text-muted-foreground text-xs">{secondaryFor(record, kind)}</span>
        </span>
      </span>
    )
  }
  return <span className={cn('inline-flex cursor-default items-center font-medium', className)}>{display}</span>
}

const MENTION_PILL: Record<PrincipalKind, string> = {
  agent: 'bg-violet-100/70 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200',
  staff: 'bg-blue-100/70 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200',
  contact: 'bg-emerald-100/70 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
}

const MENTION_HIGHLIGHT = 'bg-rose-100/80 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200'

function secondaryFor(record: PrincipalRecord | null, kind: PrincipalKind): string {
  if (!record) return KIND_LABEL[kind]
  if (record.kind === 'agent' && record.agent) return `Agent · ${record.agent.model}`
  if (record.kind === 'staff') return record.staff?.title ?? 'Staff'
  if (record.kind === 'contact') return record.contact?.email ?? record.contact?.phone ?? 'Contact'
  return KIND_LABEL[kind]
}

const KIND_LABEL: Record<PrincipalKind, string> = {
  agent: 'Agent',
  staff: 'Staff',
  contact: 'Contact',
}

function guessKind(token: string): PrincipalKind {
  if (token.startsWith('agent:')) return 'agent'
  if (token.startsWith('contact:')) return 'contact'
  return 'staff'
}

function formatTokenFallback(token: string): string {
  const idx = token.indexOf(':')
  return idx >= 0 ? token.slice(idx + 1) : token
}
