import type { ColumnDef } from '@tanstack/react-table'
import { Globe, MessageCircle } from 'lucide-react'
import { useMemo } from 'react'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { PrincipalAvatar, usePrincipalDirectory } from '@/components/principal'
import { AvatarGroup } from '@/components/ui/avatar-group'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Status } from '@/components/ui/status'
import { useDataTable } from '@/hooks/use-data-table'
import { ChannelRowMenu } from './channel-row-menu'

export interface ChannelInstanceRow {
  id: string
  organizationId: string
  channel: string
  displayName: string | null
  config: Record<string, unknown>
  status: string | null
  createdAt: string
  updatedAt: string
}

/** Maps (channel, mode, coexistence) → mode chip label + variant. Single source of truth. */
export const MODE_CHIP_MAP = {
  self_cloud: { label: 'Cloud API', variant: 'info' },
  self_coexistence: { label: 'Business App', variant: 'success' },
  managed: { label: 'Platform sandbox', variant: 'info' },
} as const

export type ModeChipKey = keyof typeof MODE_CHIP_MAP

export function getModeChip(config: Record<string, unknown>): {
  label: string
  variant: 'info' | 'success' | 'neutral'
} {
  const mode = config.mode as string | undefined
  const coexistence = config.coexistence === true

  if (mode === 'managed') return MODE_CHIP_MAP.managed
  if (mode === 'self' && coexistence) return MODE_CHIP_MAP.self_coexistence
  if (mode === 'self' && !coexistence) return MODE_CHIP_MAP.self_cloud
  return { label: '', variant: 'neutral' }
}

/** Maps instance status → DiceUI Status variant + label. */
function getHealthChip(status: string | null): { variant: 'success' | 'warning' | 'error' | 'info'; label: string } {
  switch (status) {
    case 'active':
      return { variant: 'success', label: 'Healthy' }
    case 'paused':
      return { variant: 'warning', label: 'Paused' }
    case 'error':
      return { variant: 'error', label: 'Disconnected' }
    case 'setup':
    case 'pending':
      return { variant: 'info', label: 'Setting up…' }
    default:
      return { variant: 'warning', label: 'Needs attention' }
  }
}

function ChannelGlyph({ channel }: { channel: string }) {
  if (channel === 'whatsapp') {
    return <MessageCircle className="size-4 text-[#25d366]" />
  }
  return <Globe className="size-4 text-muted-foreground" />
}

function AssigneeStack({ assignee }: { assignee: string | null | undefined }) {
  const dir = usePrincipalDirectory()
  if (!assignee) return <span className="text-muted-foreground text-xs">—</span>

  const principal = dir.resolve(assignee)
  if (!principal) return <span className="text-muted-foreground text-xs">—</span>

  return (
    <AvatarGroup max={3} size={24}>
      <PrincipalAvatar kind={principal.kind} size="sm" />
    </AvatarGroup>
  )
}

function buildColumns(
  listQueryKey: readonly unknown[],
  onEditWeb: (row: ChannelInstanceRow) => void,
  onDeleteWeb: (row: ChannelInstanceRow) => void,
  onOpenDetails: (id: string) => void,
): ColumnDef<ChannelInstanceRow>[] {
  return [
    {
      id: 'channel',
      accessorFn: (row) => row.displayName ?? row.id,
      header: 'Channel',
      cell: ({ row }) => {
        const instance = row.original
        const modeChip = instance.channel === 'whatsapp' ? getModeChip(instance.config) : null
        return (
          <div className="flex items-center gap-2">
            <ChannelGlyph channel={instance.channel} />
            <span className="font-medium text-sm">{instance.displayName ?? '(unnamed)'}</span>
            {modeChip?.label && <Status variant={modeChip.variant as 'info' | 'success'} label={modeChip.label} />}
          </div>
        )
      },
    },
    {
      id: 'origin',
      header: 'Number / Origin',
      cell: ({ row }) => {
        const { channel, config } = row.original
        const text =
          channel === 'whatsapp'
            ? ((config.displayPhoneNumber as string | undefined) ?? (config.phoneNumberId as string | undefined) ?? '—')
            : ((config.origin as string | undefined) ?? '—')
        return <span className="font-mono text-muted-foreground text-xs">{text}</span>
      },
    },
    {
      id: 'health',
      header: 'Health',
      cell: ({ row }) => {
        const { variant, label } = getHealthChip(row.original.status)
        return <Status variant={variant} label={label} />
      },
    },
    {
      id: 'assignee',
      header: 'Active',
      cell: ({ row }) => {
        const assignee = row.original.config.defaultAssignee as string | null | undefined
        return <AssigneeStack assignee={assignee} />
      },
    },
    {
      id: 'lastActivity',
      header: 'Last activity',
      cell: ({ row }) => <RelativeTimeCard date={new Date(row.original.updatedAt)} length="short" />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <ChannelRowMenu
          row={row.original}
          listQueryKey={listQueryKey}
          onEdit={() => onEditWeb(row.original)}
          onDelete={() => onDeleteWeb(row.original)}
          onOpenDetails={onOpenDetails}
        />
      ),
    },
  ]
}

interface ChannelsTableProps {
  rows: ChannelInstanceRow[]
  isLoading: boolean
  listQueryKey: readonly unknown[]
  onEditWeb: (row: ChannelInstanceRow) => void
  onDeleteWeb: (row: ChannelInstanceRow) => void
  onOpenDetails: (id: string) => void
}

export function ChannelsTable({
  rows,
  isLoading,
  listQueryKey,
  onEditWeb,
  onDeleteWeb,
  onOpenDetails,
}: ChannelsTableProps) {
  const columns = useMemo(
    () => buildColumns(listQueryKey, onEditWeb, onDeleteWeb, onOpenDetails),
    [listQueryKey, onEditWeb, onDeleteWeb, onOpenDetails],
  )

  const { table } = useDataTable({
    data: rows,
    columns,
    pageCount: 1,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  })

  if (isLoading) {
    return <DataTableSkeleton columnCount={6} rowCount={3} />
  }

  return <DataTable table={table} />
}
