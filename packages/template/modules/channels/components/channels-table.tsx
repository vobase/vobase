import type { ColumnDef } from '@tanstack/react-table'
import { Globe, MessageCircle } from 'lucide-react'
import { useMemo } from 'react'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { Principal } from '@/components/principal'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Status } from '@/components/ui/status'
import { useDataTable } from '@/hooks/use-data-table'
import { ChannelRowMenu } from './channel-row-menu'
import { WebhookStatusBadge } from './webhook-status-badge'

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

function AssigneeCell({ assignee }: { assignee: string | null | undefined }) {
  if (!assignee) return <span className="text-muted-foreground text-xs">—</span>
  return <Principal id={assignee} variant="inline" noHover />
}

function buildColumns(
  listQueryKey: readonly unknown[],
  onEditWeb: (row: ChannelInstanceRow) => void,
  onEditManaged: (row: ChannelInstanceRow) => void,
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
          <div className="flex flex-wrap items-center gap-2">
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
      // For managed WhatsApp, the webhook badge IS the health signal — it
      // tracks verified/failed/pending end-to-end. Generic `status` from the
      // row would just duplicate (or worse, contradict) it.
      cell: ({ row }) => {
        const instance = row.original
        if (instance.channel === 'whatsapp' && instance.config.mode === 'managed') {
          return <WebhookStatusBadge instanceId={instance.id} />
        }
        const { variant, label } = getHealthChip(instance.status)
        return <Status variant={variant} label={label} />
      },
    },
    {
      id: 'assignee',
      header: 'Default assignee',
      cell: ({ row }) => {
        const assignee = row.original.config.defaultAssignee as string | null | undefined
        return <AssigneeCell assignee={assignee} />
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
      cell: ({ row }) => {
        const isWhatsApp = row.original.channel === 'whatsapp'
        return (
          <ChannelRowMenu
            row={row.original}
            listQueryKey={listQueryKey}
            onEdit={() => (isWhatsApp ? onEditManaged(row.original) : onEditWeb(row.original))}
            onDelete={() => onDeleteWeb(row.original)}
            onOpenDetails={onOpenDetails}
          />
        )
      },
    },
  ]
}

interface ChannelsTableProps {
  rows: ChannelInstanceRow[]
  isLoading: boolean
  listQueryKey: readonly unknown[]
  onEditWeb: (row: ChannelInstanceRow) => void
  onEditManaged: (row: ChannelInstanceRow) => void
  onDeleteWeb: (row: ChannelInstanceRow) => void
  onOpenDetails: (id: string) => void
}

export function ChannelsTable({
  rows,
  isLoading,
  listQueryKey,
  onEditWeb,
  onEditManaged,
  onDeleteWeb,
  onOpenDetails,
}: ChannelsTableProps) {
  const columns = useMemo(
    () => buildColumns(listQueryKey, onEditWeb, onEditManaged, onDeleteWeb, onOpenDetails),
    [listQueryKey, onEditWeb, onEditManaged, onDeleteWeb, onOpenDetails],
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
