import { CheckIcon, ChevronDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react'
import { Link, useRouter } from '@tanstack/react-router'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type Theme, useTheme } from '@/hooks/use-theme'
import { authClient } from '@/lib/auth-client'

function getInitials(name: string | undefined | null, email: string | undefined | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  if (email) return email.slice(0, 2).toUpperCase()
  return '??'
}

const themeOptions: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
]

export function UserMenu() {
  const { data: session } = authClient.useSession()
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  const user = session?.user

  async function handleSignOut() {
    await authClient.signOut()
    router.invalidate()
  }

  const initials = getInitials(user?.name, user?.email)
  const displayName = user?.name ?? user?.email ?? 'Account'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar size="sm">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{displayName}</span>
            {user?.email && user.name && (
              <span className="text-xs text-muted-foreground">{user.email}</span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/profile">
            <SettingsIcon className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunIcon className="h-4 w-4" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {themeOptions.map((opt) => {
                const Icon = opt.icon
                return (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    <Icon className="h-4 w-4" />
                    {opt.label}
                    {theme === opt.value && <CheckIcon className="ml-auto h-3.5 w-3.5" />}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => { void handleSignOut() }}
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
