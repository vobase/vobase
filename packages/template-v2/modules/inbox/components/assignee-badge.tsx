import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { PrincipalAvatar, usePrincipalDirectory } from './principal'

const TRIGGER_CLASS =
  'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export function AssigneeBadge({
  assignee,
  onSelect,
  disabled,
}: {
  assignee: string | null
  onSelect: (assignee: string) => void
  disabled?: boolean
}) {
  const { resolve, agents, staff } = usePrincipalDirectory()
  const current = resolve(assignee)
  const label = current?.name ?? 'Assign'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={cn(TRIGGER_CLASS, current ? 'text-foreground' : 'text-muted-foreground')}>
          {current ? <PrincipalAvatar kind={current.kind} /> : <PrincipalAvatar kind="staff" />}
          <span className="font-medium">{label}</span>
          <ChevronDownIcon className="size-3.5 opacity-40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {agents.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">AI Agents</div>
            {agents.map((agent) => {
              const value = `agent:${agent.id}`
              return (
                <DropdownMenuItem key={agent.id} onClick={() => onSelect(value)} className="gap-2 text-sm">
                  <PrincipalAvatar kind="agent" />
                  <span className="font-medium">{agent.name}</span>
                  {value === assignee && <CheckIcon className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              )
            })}
          </>
        )}
        {agents.length > 0 && staff.length > 0 && <DropdownMenuSeparator />}
        {staff.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Team Members</div>
            {staff.map((member) => {
              const value = `user:${member.id}`
              const selected = assignee === value || assignee === member.id
              return (
                <DropdownMenuItem key={member.id} onClick={() => onSelect(value)} className="gap-2 text-sm">
                  <PrincipalAvatar kind="staff" />
                  <span className="font-medium">{member.name}</span>
                  {selected && <CheckIcon className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              )
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
