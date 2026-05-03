import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SegmentedOption {
  value: string
  label: string
  icon?: ReactNode
}

interface SettingsSegmentedProps {
  value: string
  onValueChange: (value: string) => void
  options: SegmentedOption[]
  name: string
  className?: string
}

export function SettingsSegmented({ value, onValueChange, options, name, className }: SettingsSegmentedProps) {
  return (
    <div className={cn('flex gap-0.5 rounded-md bg-foreground-5 p-0.5', className)}>
      {options.map((option) => {
        const id = `${name}-${option.value}`
        const isSelected = value === option.value
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-3 py-1.5 text-sm transition-colors',
              isSelected
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              id={id}
              name={name}
              value={option.value}
              checked={isSelected}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.icon && <span className="shrink-0 [&>svg]:size-3.5">{option.icon}</span>}
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
