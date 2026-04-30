import { UserIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type OwnershipValue = 'all' | 'mine' | 'unassigned' | string

export interface OwnershipOption {
  value: string
  label: string
  kind: 'staff' | 'agent'
}

interface OwnershipFilterProps {
  value: OwnershipValue
  onChange: (v: OwnershipValue) => void
  options?: OwnershipOption[]
}

/**
 * Ownership dropdown — second filter axis alongside the 3 tabs. Icon button
 * next to Search. Options: `All | Mine | Unassigned | <staff users…> | <agents…>`.
 *
 * Until the staff/agent directory module lands, `options` is supplied by the
 * caller from whatever `assignee` values are actually present in the loaded
 * conversation list — a pragmatic stub.
 */
export function OwnershipFilter({ value, onChange, options = [] }: OwnershipFilterProps) {
  const staff = options.filter((o) => o.kind === 'staff')
  const agents = options.filter((o) => o.kind === 'agent')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Filter by owner"
          data-owner-value={value}
          data-testid="ownership-filter-trigger"
        >
          <UserIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Owner</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value === 'all'} onCheckedChange={() => onChange('all')}>
          All
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={value === 'mine'} onCheckedChange={() => onChange('mine')}>
          Mine
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={value === 'unassigned'} onCheckedChange={() => onChange('unassigned')}>
          Unassigned
        </DropdownMenuCheckboxItem>
        {staff.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Staff</DropdownMenuLabel>
            {staff.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={value === opt.value}
                onCheckedChange={() => onChange(opt.value)}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
        {agents.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Agents</DropdownMenuLabel>
            {agents.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={value === opt.value}
                onCheckedChange={() => onChange(opt.value)}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
