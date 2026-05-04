/**
 * WhatsApp message templates viewer — read-only mirror of synced templates.
 *
 * Product decision (locked 2026-05-04): Vobase shows a read-only mirror.
 * Template creation/editing is deferred entirely to Meta WABA Manager.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Button } from '@/components/ui/button'
import { channelsClient } from '@/lib/api-client'
import { TemplatesTable } from '../components/templates-table'

export { TEMPLATE_STATUS_VARIANT_MAP } from '../components/templates-table'

interface InstanceRow {
  id: string
  displayName: string | null
  config: Record<string, unknown>
}

async function fetchInstance(instanceId: string): Promise<InstanceRow> {
  const r = await channelsClient.instances[':id'].$get({ param: { id: instanceId } })
  if (!r.ok) throw new Error(`instance fetch failed: ${r.status}`)
  return (await r.json()) as InstanceRow
}

function ChannelTemplatesPage() {
  const { instanceId } = useParams({ from: '/_app/channels/$instanceId/templates' })
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const { data: instance } = useQuery({
    queryKey: ['channels', 'instance', instanceId],
    queryFn: () => fetchInstance(instanceId),
  })

  const wabaId = instance?.config.wabaId as string | undefined

  async function handleSync() {
    setSyncing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ['channels', 'instance', instanceId] })
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
