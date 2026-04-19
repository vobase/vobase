import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type FilterKey = 'all' | 'unread' | 'awaiting_approval' | 'assigned_to_me' | 'archived'

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'awaiting_approval', label: 'Pending' },
  { key: 'assigned_to_me', label: 'Mine' },
  { key: 'archived', label: 'Archived' },
]

interface FilterTabBarProps {
  value: FilterKey
  onChange: (v: FilterKey) => void
  counts?: Partial<Record<FilterKey, number>>
}

function FilterTabBar({ value, onChange, counts }: FilterTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Conversation filters"
      className="flex h-10 shrink-0 items-center border-b border-[var(--color-border-subtle)] px-3"
    >
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v as FilterKey)
        }}
        className="gap-0.5"
      >
        {TABS.map(({ key, label }) => (
          <ToggleGroupItem
            key={key}
            value={key}
            role="tab"
            aria-selected={value === key}
            size="sm"
            className="h-7 rounded-full px-3 text-[12px] data-[state=on]:bg-[var(--color-accent)] data-[state=on]:text-white"
          >
            {label}
            {counts?.[key] !== undefined && (
              <span className="ml-1 text-[11px] opacity-70">({counts[key]})</span>
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export type { FilterTabBarProps }
export { FilterTabBar }
