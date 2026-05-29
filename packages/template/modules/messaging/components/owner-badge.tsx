import { CheckIcon, ChevronDownIcon, UserXIcon } from 'lucide-react'

import { Principal } from '@/components/principal'
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

/**
 * The conversation's owner control — the single "Assigned to" dropdown staff
 * manage. Lists staff only (the owner is always a person) plus an Unassigned
 * option. Distinct from the responder: setting an owner does not change who
 * replies, so there is no agent in this list.
 */
export function OwnerBadge({
  ownerUserId,
  onSelect,
  disabled,
}: {
  ownerUserId: string | null
  onSelect: (ownerUserId: string | null) => void
  disabled?: boolean
}) {
  const { resolve, staff } = usePrincipalDirectory()
  const current = ownerUserId ? resolve(`user:${ownerUserId}`) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={cn(TRIGGER_CLASS, current ? 'text-foreground' : 'text-muted-foreground')}>
          <span className="sr-only text-muted-foreground text-xs sm:not-sr-only">Owner</span>
          {current ? (
            <>
              <PrincipalAvatar kind="staff" />
              <Principal id={current.token} variant="simple" noHover className="font-medium" />
            </>
          ) : (
            <span className="font-medium">Unassigned</span>
          )}
          <ChevronDownIcon className="size-3.5 opacity-40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuItem onClick={() => onSelect(null)} className="gap-2 text-sm">
          <UserXIcon className="size-4 text-muted-foreground" />
          <span className="font-medium">Unassigned</span>
          {!ownerUserId && <CheckIcon className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        {staff.length > 0 && <DropdownMenuSeparator />}
        {staff.map((member) => (
          <DropdownMenuItem key={member.id} onClick={() => onSelect(member.id)} className="gap-2 text-sm">
            <PrincipalAvatar kind="staff" />
            <span className="font-medium">{member.name}</span>
            {ownerUserId === member.id && <CheckIcon className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
