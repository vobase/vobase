/**
 * WhatsApp message templates viewer — read-only mirror of synced templates.
 *
 * Product decision (locked 2026-05-04): Vobase shows a read-only mirror.
 * Template creation/editing is deferred entirely to Meta WABA Manager.
 */

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTimeCard } from '@/components/ui/relative-time'
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

const templateStatusVariant = (status: string) => {
  switch (status.toUpperCase()) {
    case 'APPROVED':
      return 'success' as const
    case 'REJECTED':
      return 'error' as const
    case 'PENDING':
    case 'PENDING_DELETION':
      return 'info' as const
    case 'DISABLED':
      return 'warning' as const
    default:
      return 'neutral' as const
  }
}

/** Maps Meta template status → DiceUI Status variant (for unit tests). */
export const TEMPLATE_STATUS_VARIANT_MAP = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  DISABLED: 'warning',
} as const

async function fetchTemplates(instanceId: string): Promise<WhatsAppTemplate[]> {
  // Templates are fetched through the generic instances endpoint config
  // The adapter syncs them via syncTemplates — here we load from instance config cache
  const r = await channelsClient.instances[':id'].$get({ param: { id: instanceId } })
  if (!r.ok) throw new Error(`instance fetch failed: ${r.status}`)
  const instance = (await r.json()) as InstanceRow
  const templates = instance.config.templates as WhatsAppTemplate[] | undefined
  return templates ?? []
}

async function fetchInstance(instanceId: string): Promise<InstanceRow> {
  const r = await channelsClient.instances[':id'].$get({ param: { id: instanceId } })
  if (!r.ok) throw new Error(`instance fetch failed: ${r.status}`)
  return (await r.json()) as InstanceRow
}

function TemplatesTable({ instanceId }: { instanceId: string }) {
  const { data: instance } = useQuery({
    queryKey: ['channels', 'instance', instanceId],
    queryFn: () => fetchInstance(instanceId),
  })
  const {
    data: templates = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['channels', 'templates', instanceId],
    queryFn: () => fetchTemplates(instanceId),
  })

  const wabaId = instance?.config.wabaId as string | undefined

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
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

function ChannelTemplatesPage() {
  const { instanceId } = useParams({ from: '/_app/channels/$instanceId/templates' })
  const [syncing, setSyncing] = useState(false)

  const { data: instance } = useQuery({
    queryKey: ['channels', 'instance', instanceId],
    queryFn: () => fetchInstance(instanceId),
  })

  const wabaId = instance?.config.wabaId as string | undefined

  async function handleSync() {
    setSyncing(true)
    try {
      // Sync is triggered by re-fetching; the adapter handles it server-side
      await channelsClient.instances[':id'].$get({ param: { id: instanceId } })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title={instance?.displayName ? `${instance.displayName} — Templates` : 'Message Templates'}
        description="Read-only mirror of templates synced from Meta WABA Manager."
        actions={
          <div className="flex items-center gap-2">
            {wabaId && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${wabaId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-1.5"
                >
                  <ExternalLink className="size-3.5" />
                  Open Meta WABA Manager
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1.5">
              <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sync from Meta
            </Button>
          </div>
        }
      />
      <PageBody>
        <p className="mb-4 text-muted-foreground text-sm">
          Templates are managed in{' '}
          <a
            href="https://business.facebook.com/wa/manage/message-templates/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Meta WABA Manager
          </a>
          . Click any row to edit there.
        </p>
        <TemplatesTable instanceId={instanceId} />
      </PageBody>
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/channels/$instanceId/templates')({
  component: ChannelTemplatesPage,
})
