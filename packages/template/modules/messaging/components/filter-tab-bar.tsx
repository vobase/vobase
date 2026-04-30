import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
    <div className="shrink-0 border-[var(--color-border-subtle)] border-b px-3 pt-2 pb-2">
      <Tabs value={value} onValueChange={(v) => onChange(v as FilterKey)}>
        <TabsList className="w-full">
          {TABS.map(({ key, label }) => {
            const count = counts?.[key]
            return (
              <TabsTrigger key={key} value={key} aria-selected={value === key} className="flex-1 gap-1.5 text-sm">
                {label}
                {count ? (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 font-bold text-xs">
                    {count > 99 ? '99+' : count}
                  </Badge>
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
    </div>
  )
}

export type { FilterTabBarProps }
export { FilterTabBar }
