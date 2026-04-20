import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface NavUserProps {
  name?: string
  email?: string
}

export function NavUser({ name = 'User', email = '' }: NavUserProps) {
  const [signOutOpen, setSignOutOpen] = useState(false)

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="User menu"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none"
          >
            <Avatar className="size-7 shrink-0">
              <AvatarFallback className="bg-[var(--color-surface-elevated)] text-2xs text-[var(--color-fg-muted)]">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-[var(--color-fg)]">{name}</span>
            <ChevronDown className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-48">
          {email && (
            <>
              <div className="truncate px-2 py-1.5 text-xs text-[var(--color-fg-muted)]">{email}</div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <a href="/settings/account">Account</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/settings/appearance">Preferences</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSignOutOpen(true)} className="text-destructive focus:text-destructive">
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  )
}
