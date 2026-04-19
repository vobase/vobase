import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export type FilterKey = 'all' | 'unread' | 'awaiting_approval' | 'assigned_to_me' | 'archived'

const CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'awaiting_approval', label: 'Pending' },
  { key: 'assigned_to_me', label: 'Mine' },
  { key: 'archived', label: 'Archived' },
]

const MAX_VISIBLE = 5

interface FilterChipsProps {
  active: FilterKey
  onChange: (key: FilterKey) => void
}

function FilterChips({ active, onChange }: FilterChipsProps) {
  const visible = CHIPS.slice(0, MAX_VISIBLE)
  const overflow = CHIPS.slice(MAX_VISIBLE)

  return (
    <div className="flex items-center gap-1">
      {visible.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'h-7 rounded-md px-2 text-[12px] font-medium transition-colors',
            active === key
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]',
          )}
        >
          {label}
        </button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="h-7 gap-0.5">
              More <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {overflow.map(({ key, label }) => (
              <DropdownMenuItem key={key} onClick={() => onChange(key)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export { FilterChips }
export type { FilterChipsProps }
