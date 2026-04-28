/**
 * Hovercard body for a resolved principal. Renders identity (avatar, name,
 * id), kind-specific metadata (model/title/email…), and a typed link to the
 * detail page. Wrap in <HoverCardContent> at the call site.
 */

import { Link } from '@tanstack/react-router'
import { ArrowUpRightIcon, MailIcon, PhoneIcon } from 'lucide-react'

import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { cn } from '@/lib/utils'
import { PrincipalAvatar } from './avatar'
import type { PrincipalKind, PrincipalRecord } from './directory'

const KIND_LABEL: Record<PrincipalKind, string> = {
  agent: 'AI agent',
  staff: 'Staff',
  contact: 'Contact',
}

const KIND_BADGE: Record<PrincipalKind, string> = {
  agent: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  staff: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  contact: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

export function PrincipalHoverCard({ record }: { record: PrincipalRecord }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 p-3">
        <PrincipalAvatar kind={record.kind} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate font-semibold text-sm">{record.name}</div>
            {record.kind === 'staff' && record.staff && <PresenceDot online={record.staff.isOnline} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn('rounded px-1.5 py-0.5 font-medium', KIND_BADGE[record.kind])}>
              {KIND_LABEL[record.kind]}
            </span>
            <span className="truncate font-mono text-muted-foreground">{record.id}</span>
          </div>
        </div>
      </div>

      <Detail record={record} />

      <PrincipalLink record={record} />
    </div>
  )
}

function Detail({ record }: { record: PrincipalRecord }) {
  if (record.kind === 'agent' && record.agent) {
    return (
      <div className="border-t bg-muted/30 px-3 py-2 text-xs">
        <DetailRow label="Model" value={record.agent.model} />
        <DetailRow label="Status" value={record.agent.enabled ? 'Enabled' : 'Disabled'} />
      </div>
    )
  }
  if (record.kind === 'staff' && record.staff) {
    return (
      <div className="border-t bg-muted/30 px-3 py-2 text-xs">
        {record.staff.title ? <DetailRow label="Title" value={record.staff.title} /> : null}
        <DetailRow label="Availability" value={capitalize(record.staff.availability)} />
        <DetailRow
          label="Last seen"
          value={
            record.staff.lastSeenAt ? (
              <RelativeTimeCard date={record.staff.lastSeenAt} length="short" className="text-foreground" />
            ) : (
              'Never'
            )
          }
        />
      </div>
    )
  }
  if (record.kind === 'contact' && record.contact) {
    const { email, phone } = record.contact
    if (!email && !phone) return null
    return (
      <div className="flex flex-col gap-1 border-t bg-muted/30 px-3 py-2 text-xs">
        {email ? (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
            <MailIcon className="size-3 shrink-0" />
            <span className="truncate">{email}</span>
          </a>
        ) : null}
        {phone ? (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
            <PhoneIcon className="size-3 shrink-0" />
            <span className="truncate">{phone}</span>
          </a>
        ) : null}
      </div>
    )
  }
  return null
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  )
}

function PrincipalLink({ record }: { record: PrincipalRecord }) {
  const className =
    'flex items-center justify-between border-t px-3 py-2 text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground'
  if (record.kind === 'agent') {
    return (
      <Link to="/agents/$id" params={{ id: record.id }} className={className}>
        <span>Open agent</span>
        <ArrowUpRightIcon className="size-3.5" />
      </Link>
    )
  }
  if (record.kind === 'staff') {
    return (
      <Link to="/team/$userId" params={{ userId: record.id }} className={className}>
        <span>Open profile</span>
        <ArrowUpRightIcon className="size-3.5" />
      </Link>
    )
  }
  return (
    <Link to="/contacts/$id" params={{ id: record.id }} className={className}>
      <span>Open contact</span>
      <ArrowUpRightIcon className="size-3.5" />
    </Link>
  )
}

function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-xs',
        online ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden />
      {online ? 'Online' : 'Offline'}
    </span>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
