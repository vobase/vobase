/**
 * Principal = agent or staff. Shared rendering for any place that displays an
 * agent/staff identifier: assignee trigger, note author, reassign activity row.
 *
 * Resolves `assignee` strings (`agent:<id>`, `user:<id>`, or raw staff id) to
 * a human display name and a colored icon (purple robot for agents, blue
 * person for staff). Avatars are not stored yet — the icon is the avatar.
 */

import { useAgentDefinitions } from '@modules/agents/api/use-agent-definitions'
import { useStaffList } from '@modules/team/api/use-staff'
import { BotIcon, UserIcon } from 'lucide-react'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'

export type PrincipalKind = 'agent' | 'staff'

export interface Principal {
  kind: PrincipalKind
  id: string
  name: string
}

export interface PrincipalDirectory {
  resolve(value: string | null | undefined): Principal | null
  agents: Array<{ id: string; name: string }>
  staff: Array<{ id: string; name: string }>
}

export function usePrincipalDirectory(): PrincipalDirectory {
  const { data: agentDefs = [] } = useAgentDefinitions()
  const { data: staffList = [] } = useStaffList()

  return useMemo(() => {
    const agents = agentDefs.map((a) => ({ id: a.id, name: a.name }))
    const staff = staffList.map((s) => ({ id: s.userId, name: s.displayName ?? s.userId }))
    const agentById = new Map(agents.map((a) => [a.id, a.name]))
    const staffById = new Map(staff.map((s) => [s.id, s.name]))

    function resolve(value: string | null | undefined): Principal | null {
      if (!value) return null
      if (value.startsWith('agent:')) {
        const id = value.slice(6)
        return { kind: 'agent', id, name: agentById.get(id) ?? humanize(id) }
      }
      const id = value.startsWith('user:') ? value.slice(5) : value
      return { kind: 'staff', id, name: staffById.get(id) ?? humanize(id) }
    }

    return { resolve, agents, staff }
  }, [agentDefs, staffList])
}

function humanize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
}

const AVATAR_SIZE: Record<'sm' | 'md', string> = {
  sm: 'size-5',
  md: 'size-6',
}

const ICON_SIZE: Record<'sm' | 'md', string> = {
  sm: 'size-3',
  md: 'size-3.5',
}

export function PrincipalAvatar({
  kind,
  size = 'sm',
  className,
}: {
  kind: PrincipalKind
  size?: 'sm' | 'md'
  className?: string
}) {
  const Icon = kind === 'agent' ? BotIcon : UserIcon
  const ring =
    kind === 'agent'
      ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
      : 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full shrink-0',
        AVATAR_SIZE[size],
        ring,
        className,
      )}
      aria-hidden
    >
      <Icon className={ICON_SIZE[size]} />
    </span>
  )
}

/** Inline avatar + display name. Used anywhere we'd otherwise show a raw id. */
export function PrincipalChip({
  principal,
  size = 'sm',
  className,
}: {
  principal: Principal
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <PrincipalAvatar kind={principal.kind} size={size} />
      <span className="font-medium truncate">{principal.name}</span>
    </span>
  )
}
