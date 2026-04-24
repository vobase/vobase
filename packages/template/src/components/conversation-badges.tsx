import { Link } from '@tanstack/react-router'
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  GlobeIcon,
  MailIcon,
  MessageSquareIcon,
  MicIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// ─── Shared ──────────────────────────────────────────────────────────

const FIELD_TRIGGER_CLASS =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

// ─── Priority ────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', marks: '!!!', color: 'text-red-500' },
  high: { label: 'High', marks: '!!', color: 'text-muted-foreground' },
  normal: { label: 'Normal', marks: '!', color: 'text-muted-foreground' },
  low: { label: 'Low', marks: '·', color: 'text-muted-foreground' },
} as const

type PriorityValue = keyof typeof PRIORITY_CONFIG

function getPriorityConfig(priority: string | null) {
  if (!priority) return null
  return PRIORITY_CONFIG[priority as PriorityValue] ?? null
}

/** Exclamation-mark indicator for inline use (returns null for low/none). */
export function PriorityIcon({ priority, className }: { priority: string | null; className?: string }) {
  const cfg = getPriorityConfig(priority)
  if (!cfg || priority === 'low') return null

  return <span className={cn('text-[10px] font-black leading-none shrink-0', cfg.color, className)}>{cfg.marks}</span>
}

/** Full priority badge with marks — shows dash for null. */
function PriorityMarks({ priority }: { priority: string | null }) {
  const cfg = getPriorityConfig(priority)
  if (!cfg) {
    return <span className="text-[10px] font-black text-muted-foreground/40">—</span>
  }
  return <span className={cn('text-[10px] font-black', cfg.color)}>{cfg.marks}</span>
}

export function PriorityBadge({
  priority,
  variant = 'badge',
  onSelect,
  disabled,
}: {
  priority: string | null
  variant?: 'field' | 'icon' | 'badge'
  onSelect?: (priority: string | null) => void
  disabled?: boolean
}) {
  const cfg = getPriorityConfig(priority)
  const label = cfg?.label ?? 'No priority'

  if (variant === 'icon') {
    return <PriorityIcon priority={priority} />
  }

  if (variant === 'field' && onSelect) {
    const options = [
      { value: null, label: 'No priority' },
      ...Object.entries(PRIORITY_CONFIG).map(([value, c]) => ({
        value,
        label: c.label,
      })),
    ]

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className={cn(FIELD_TRIGGER_CLASS)}>
            <PriorityMarks priority={priority} />
            <span className="font-medium">{label}</span>
            <ChevronDownIcon className="h-3 w-3 opacity-40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          {options.map((opt) => (
            <DropdownMenuItem key={opt.value ?? '_none'} onClick={() => onSelect(opt.value)} className="gap-2 text-sm">
              <PriorityMarks priority={opt.value} />
              {opt.label}
              {opt.value === priority && <CheckIcon className="ml-auto h-3.5 w-3.5 text-foreground" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // badge (read-only)
  if (!cfg) return null
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-sm text-muted-foreground">
      <PriorityMarks priority={priority} />
      {label}
    </span>
  )
}

// ─── Status ──────────────────────────────────────────────────────────

const STATUS_VARIANT_MAP: Record<string, 'default' | 'success' | 'destructive' | 'secondary'> = {
  active: 'default',
  completed: 'success',
  failed: 'destructive',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant={STATUS_VARIANT_MAP[status] ?? 'secondary'}
      className={cn('text-xs capitalize h-5 px-1.5', className)}
    >
      {status}
    </Badge>
  )
}

// ─── Channel ─────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<string, { label: string; Icon: typeof GlobeIcon }> = {
  whatsapp: { label: 'WhatsApp', Icon: MessageSquareIcon },
  web: { label: 'Web Chat', Icon: GlobeIcon },
  email: { label: 'Email', Icon: MailIcon },
  voice: { label: 'Voice', Icon: MicIcon },
}

function getChannelConfig(type: string) {
  return (
    CHANNEL_CONFIG[type] ?? {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      Icon: GlobeIcon,
    }
  )
}

export function ChannelBadge({
  type,
  variant = 'badge',
  className,
}: {
  type: string | null
  variant?: 'icon' | 'badge'
  className?: string
}) {
  if (!type) return null
  const cfg = getChannelConfig(type)

  if (variant === 'icon') {
    return (
      <span className={cn('inline-flex items-center text-muted-foreground/70', className)}>
        <cfg.Icon className="h-2.5 w-2.5" />
      </span>
    )
  }

  // badge
  return (
    <Badge variant="outline" className={cn('text-xs font-normal h-5 border-dashed', className)}>
      <cfg.Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </Badge>
  )
}

// ─── Assignee ────────────────────────────────────────────────────────

function getAssigneeDisplay(
  assignee: string | null,
  agents: Array<{ id: string; name: string }>,
  teamMembers: Array<{ id: string; name: string }>,
): { label: string; isAgent: boolean } {
  if (!assignee) return { label: 'Assign', isAgent: false }
  if (assignee.startsWith('agent:')) {
    const agentId = assignee.slice(6)
    const agent = agents.find((a) => a.id === agentId)
    const label = agent?.name ?? agentId.charAt(0).toUpperCase() + agentId.slice(1).replace(/-/g, ' ')
    return { label, isAgent: true }
  }
  const member = teamMembers.find((m) => m.id === assignee)
  return { label: member?.name ?? 'Staff', isAgent: false }
}

export function AssigneeBadge({
  assignee,
  variant = 'badge',
  onSelect,
  disabled,
  agents = [],
  teamMembers = [],
}: {
  assignee: string | null
  variant?: 'field' | 'badge'
  onSelect?: (assignee: string | null) => void
  disabled?: boolean
  agents?: Array<{ id: string; name: string }>
  teamMembers?: Array<{ id: string; name: string }>
}) {
  const { label, isAgent } = getAssigneeDisplay(assignee, agents, teamMembers)
  const AssigneeIcon = isAgent ? BotIcon : UserIcon
  const iconClass = isAgent ? 'text-violet-500' : assignee ? 'text-foreground' : 'text-muted-foreground'

  if (variant === 'field' && onSelect) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(FIELD_TRIGGER_CLASS, assignee ? 'text-foreground' : 'text-muted-foreground')}
          >
            <AssigneeIcon className={cn('h-3.5 w-3.5', iconClass)} />
            <span className="font-medium">{label}</span>
            <ChevronDownIcon className="h-3 w-3 opacity-40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {agents.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">AI Agents</div>
              {agents.map((agent) => {
                const value = `agent:${agent.id}`
                return (
                  <DropdownMenuItem key={agent.id} onClick={() => onSelect(value)} className="gap-2 text-sm">
                    <BotIcon className="h-3.5 w-3.5 text-violet-500" />
                    {agent.name}
                    {value === assignee && <CheckIcon className="ml-auto h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                )
              })}
            </>
          )}
          {agents.length > 0 && teamMembers.length > 0 && <DropdownMenuSeparator />}
          {teamMembers.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Team Members</div>
              {teamMembers.map((member) => (
                <DropdownMenuItem key={member.id} onClick={() => onSelect(member.id)} className="gap-2 text-sm">
                  <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {member.name}
                  {member.id === assignee && <CheckIcon className="ml-auto h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {(agents.length > 0 || teamMembers.length > 0) && assignee && <DropdownMenuSeparator />}
          {assignee && (
            <DropdownMenuItem onClick={() => onSelect(null)} className="gap-2 text-sm text-muted-foreground">
              <XCircleIcon className="h-3.5 w-3.5" />
              Unassign
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // badge (read-only)
  if (!assignee) return null
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-sm text-muted-foreground">
      <AssigneeIcon className={cn('h-3.5 w-3.5', iconClass)} />
      {label}
    </span>
  )
}

// ─── Resolution outcome ──────────────────────────────────────────────

function _ResolutionBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null
  return <span className="text-xs text-muted-foreground capitalize">{outcome.replaceAll('_', ' ')}</span>
}
