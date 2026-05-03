import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'

import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type ThemeValue = 'light' | 'dark' | 'system'

export const THEME_OPTIONS: { value: ThemeValue; label: string; Icon: React.ElementType }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
]

const ROW_BASE =
  'flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground-3 hover:text-foreground @max-[80px]/rail:justify-center @max-[80px]/rail:gap-0 @max-[80px]/rail:px-0 data-[state=open]:bg-foreground-3 data-[state=open]:text-foreground'

interface ThemeSwitchProps {
  /** `'icon'` (default) renders a ghost icon button; `'row'` matches the desktop rail's NavItem shape. */
  variant?: 'icon' | 'row'
  /** For testing only — forces menu open in SSR snapshots */
  defaultOpen?: boolean
}

export function ThemeSwitch({ variant = 'icon', defaultOpen }: ThemeSwitchProps = {}) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const TriggerIcon = resolvedTheme === 'dark' ? MoonIcon : SunIcon

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        {variant === 'row' ? (
          <button type="button" aria-label="Toggle theme" className={cn(ROW_BASE)}>
            <TriggerIcon className="size-[18px] shrink-0" aria-hidden="true" />
            <span className="@max-[80px]/rail:hidden truncate">Theme</span>
          </button>
        ) : (
          <Button variant="ghost" size="icon" aria-label="Toggle theme">
            <TriggerIcon aria-hidden="true" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)} aria-label={`Switch to ${label} theme`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {theme === value && <CheckIcon className="ml-auto" aria-label="active" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
