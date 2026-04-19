import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ThemeValue = 'light' | 'dark' | 'system'

export const THEME_OPTIONS: { value: ThemeValue; label: string; Icon: React.ElementType }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
]

interface ThemeSwitchProps {
  /** For testing only — forces menu open in SSR snapshots */
  defaultOpen?: boolean
}

export function ThemeSwitch({ defaultOpen }: ThemeSwitchProps = {}) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const TriggerIcon = resolvedTheme === 'dark' ? MoonIcon : SunIcon

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <TriggerIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            aria-label={`Switch to ${label} theme`}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {theme === value && <CheckIcon className="ml-auto" aria-label="active" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
