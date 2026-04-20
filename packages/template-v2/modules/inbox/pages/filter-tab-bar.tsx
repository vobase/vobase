import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type FilterKey = 'active' | 'later' | 'done'

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'later', label: 'Later' },
  { key: 'done', label: 'Done' },
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
            className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {label}
            {counts?.[key] !== undefined && <span className="ml-1 text-mini opacity-70">({counts[key]})</span>}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export type { FilterTabBarProps }
export { FilterTabBar }
