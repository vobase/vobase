import { useQuery } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Status } from '@/components/ui/status'
import { channelsClient } from '@/lib/api-client'

interface WhatsAppTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  rejectedReason?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

interface InstanceRow {
  id: string
  displayName: string | null
  config: Record<string, unknown>
}

const TEMPLATES_SKELETON_KEYS = ['row-1', 'row-2', 'row-3'] as const

/** Maps Meta template status → DiceUI Status variant. Single source of truth. */
export const TEMPLATE_STATUS_VARIANT_MAP = {
  PENDING: 'info',
  PENDING_DELETION: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  DISABLED: 'warning',
} as const

const templateStatusVariant = (status: string) =>
  TEMPLATE_STATUS_VARIANT_MAP[status.toUpperCase() as keyof typeof TEMPLATE_STATUS_VARIANT_MAP] ?? ('neutral' as const)

async function fetchInstance(instanceId: string): Promise<InstanceRow> {
  const r = await channelsClient.instances[':id'].$get({ param: { id: instanceId } })
  if (!r.ok) throw new Error(`instance fetch failed: ${r.status}`)
  return (await r.json()) as InstanceRow
}

export function TemplatesTable({ instanceId }: { instanceId: string }) {
  const {
    data: instance,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['channels', 'instance', instanceId],
    queryFn: () => fetchInstance(instanceId),
  })

  const wabaId = instance?.config.wabaId as string | undefined
  const templates = (instance?.config.templates as WhatsAppTemplate[] | undefined) ?? []

  if (isLoading) {
    return (
      <div className="space-y-2">
        {TEMPLATES_SKELETON_KEYS.map((k) => (
          <Skeleton key={k} className="h-14 rounded-lg" />
        ))}
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia>
            <RefreshCw className="size-6 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>No templates synced</EmptyTitle>
          <EmptyDescription>Click "Sync from Meta" to pull the latest templates from your WABA.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b bg-muted/50">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Name</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Language</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Category</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Status</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Updated</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {templates.map((tpl) => (
            <tr key={`${tpl.name}-${tpl.language}`} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-mono text-xs">{tpl.name}</td>
              <td className="px-4 py-3 text-muted-foreground text-xs uppercase">{tpl.language}</td>
              <td className="px-4 py-3 text-muted-foreground text-xs">{tpl.category}</td>
              <td className="px-4 py-3">
                <Status variant={templateStatusVariant(tpl.status)} label={tpl.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground text-xs">
                {tpl.updatedAt ? <RelativeTimeCard date={new Date(tpl.updatedAt)} length="short" /> : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {wabaId && (
                  <a
                    href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${wabaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                  >
                    <ExternalLink className="size-3" />
                    Edit in Meta
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isFetching && <div className="border-border border-t px-4 py-2 text-muted-foreground text-xs">Refreshing…</div>}
    </div>
  )
}
