import { Link } from '@tanstack/react-router'
import { LogOut, Settings, UserRound } from 'lucide-react'
import { useState } from 'react'

import { SignOutDialog } from '@/components/sign-out-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCurrentUserId } from '@/hooks/use-current-user'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  if (email) return email.slice(0, 2).toUpperCase()
  return '??'
}

const ROW_BASE =
  'flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground-3 hover:text-foreground @max-[80px]/rail:justify-center @max-[80px]/rail:gap-0 @max-[80px]/rail:px-0 data-[state=open]:bg-foreground-3 data-[state=open]:text-foreground'

const ICON_BASE =
  'flex size-10 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent'

interface NavUserProps {
  /** `'icon'` (default) renders a 40px circular avatar trigger; `'row'` matches the desktop rail's NavItem shape. */
  variant?: 'icon' | 'row'
}

export function NavUser({ variant = 'icon' }: NavUserProps) {
  const session = authClient.useSession() as unknown as {
    data?: { user?: { name?: string | null; email?: string | null } | null } | null
  } | null
  const user = session?.data?.user ?? null
  const userId = useCurrentUserId()
  const [signOutOpen, setSignOutOpen] = useState(false)

  const name = user?.name ?? null
  const email = user?.email ?? null
  const initials = getInitials(name, email)
  const displayName = name ?? email ?? 'Account'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="User menu" className={cn(variant === 'row' ? ROW_BASE : ICON_BASE)}>
            <Avatar className={variant === 'row' ? 'size-[18px]' : 'size-7'}>
              <AvatarFallback className="font-medium text-2xs">{initials}</AvatarFallback>
            </Avatar>
            {variant === 'row' && <span className="@max-[80px]/rail:hidden truncate">{displayName}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-56 rounded-lg">
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-start leading-tight">
                <span className="truncate font-semibold">{displayName}</span>
                {email && name && <span className="truncate text-muted-foreground text-xs">{email}</span>}
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {userId && (
              <DropdownMenuItem asChild>
                <Link to="/team/$userId" params={{ userId }}>
                  <UserRound />
                  Profile
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings />
                Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setSignOutOpen(true)}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  )
}
