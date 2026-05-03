import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface SettingsToggleProps {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function SettingsToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SettingsToggleProps) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-sm">{label}</span>
        {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="ml-4 shrink-0">
        <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
    </div>
  )
}
