import type { ManagedChannelKind } from '@modules/channels/managed/registry'
import type { ColumnDef } from '@tanstack/react-table'
import { Globe, MessageCircle } from 'lucide-react'
import { useMemo } from 'react'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { Principal } from '@/components/principal'
import { Button } from '@/components/ui/button'
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
  /**
   * Synthetic rows the table renders for each unclaimed managed kind. They
   * never exist in the database — the only mutation they accept is the
   * "Connect" CTA which opens the connect dialog. Real rows always omit the
   * field.
   */
  placeholderKind?: ManagedChannelKind
  /**
   * Number of free pool slots reported by the platform for this kind. `null`
   * means availability is still loading or the platform hasn't returned a
   * count. `0` flips the row from "Not connected" → "Pool exhausted" and
   * disables the Connect button so operators don't click into a 503.
   */
  placeholderAvailable?: number | null
}

/** Maps (channel, mode, coexistence) → mode chip label + variant. Single source of truth. */
export const MODE_CHIP_MAP = {
  self_cloud: { label: 'Cloud API', variant: 'info' },
  self_coexistence: { label: 'Business App', variant: 'success' },
  managed: { label: 'Platform sandbox', variant: 'info' },
  'managed-notif': { label: 'Platform notification', variant: 'success' },
} as const

export type ModeChipKey = keyof typeof MODE_CHIP_MAP

export function getModeChip(
  channel: string,
  config: Record<string, unknown>,
): {
  label: string
  variant: 'info' | 'success' | 'neutral'
} {
  const mode = config.mode as string | undefined
  const coexistence = config.coexistence === true

  // Every managed kind stores `config.mode === 'managed'` (the WhatsApp
  // adapter's `isManagedConfig` predicate keys on it). Sandbox vs notification
  // is distinguished by the `channel` discriminator, not by `mode`.
  if (mode === 'managed') {
    return channel === 'whatsapp_notif' ? MODE_CHIP_MAP['managed-notif'] : MODE_CHIP_MAP.managed
  }
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
  // `whatsapp_notif` is the notification-tier managed channel and shares
  // the WhatsApp brand mark with the customer-facing `whatsapp` row.
  if (channel === 'whatsapp' || channel === 'whatsapp_notif') {
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
  onConnectPlaceholder: ((kind: ManagedChannelKind) => void) | undefined,
): ColumnDef<ChannelInstanceRow>[] {
  return [
    {
      id: 'channel',
      accessorFn: (row) => row.displayName ?? row.id,
      header: 'Channel',
      cell: ({ row }) => {
        const instance = row.original
        // Show the mode chip for every WhatsApp row (self-cloud, business-app,
        // platform sandbox, platform notification). The chip is the only
        // place the channel kind is surfaced once the `displayName` is set
        // from the platform `label` instead of `${kindSpec.displayLabel}
        // (${env})`.
        const isWhatsApp = instance.channel === 'whatsapp' || instance.channel === 'whatsapp_notif'
        const modeChip = isWhatsApp ? getModeChip(instance.channel, instance.config) : null
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
        const isWhatsApp = channel === 'whatsapp' || channel === 'whatsapp_notif'
        const text = isWhatsApp
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
        if (instance.placeholderKind) {
          if (instance.placeholderAvailable === 0) {
            return <Status variant="warning" label="Pool exhausted" />
          }
          return <Status variant="neutral" label="Not connected" />
        }
        const isManagedWhatsApp =
          (instance.channel === 'whatsapp' || instance.channel === 'whatsapp_notif') &&
          instance.config.mode === 'managed'
        if (isManagedWhatsApp) {
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
      cell: ({ row }) => {
        if (row.original.placeholderKind) return <span className="text-muted-foreground text-xs">—</span>
        return <RelativeTimeCard date={new Date(row.original.updatedAt)} length="short" />
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const placeholderKind = row.original.placeholderKind
        if (placeholderKind) {
          // Match `ChannelRowMenu`'s right-aligned wrapper so the button
          // lines up with menu triggers in non-placeholder rows. Disabled
          // when the platform reports 0 free slots — clicking would just
          // 503 with `pool_exhausted`.
          const exhausted = row.original.placeholderAvailable === 0
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => onConnectPlaceholder?.(placeholderKind)}
                disabled={exhausted}
                title={exhausted ? 'Platform pool is empty — ask your operator to add a number.' : undefined}
              >
                <span className="text-xs">Connect</span>
              </Button>
            </div>
          )
        }
        const isWhatsApp = row.original.channel === 'whatsapp' || row.original.channel === 'whatsapp_notif'
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
  /** Fires when the operator clicks "Connect" on a placeholder row. */
  onConnectPlaceholder?: (kind: ManagedChannelKind) => void
}

export function ChannelsTable({
  rows,
  isLoading,
  listQueryKey,
  onEditWeb,
  onEditManaged,
  onDeleteWeb,
  onOpenDetails,
  onConnectPlaceholder,
}: ChannelsTableProps) {
  const columns = useMemo(
    () => buildColumns(listQueryKey, onEditWeb, onEditManaged, onDeleteWeb, onOpenDetails, onConnectPlaceholder),
    [listQueryKey, onEditWeb, onEditManaged, onDeleteWeb, onOpenDetails, onConnectPlaceholder],
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
