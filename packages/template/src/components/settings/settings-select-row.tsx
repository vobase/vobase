import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useIsMobile } from '@/hooks/use-viewport'
import { cn } from '@/lib/utils'

interface SelectOption {
  value: string
  label: string
}

interface SettingsSelectRowProps {
  label: string
  description?: string
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
}

export function SettingsSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: SettingsSelectRowProps) {
  const isMobile = useIsMobile()

  return (
    <div className={cn('flex items-center justify-between px-4 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-sm">{label}</span>
        {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="ml-4 shrink-0">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className={cn(isMobile ? 'w-full' : 'w-[180px]')}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
