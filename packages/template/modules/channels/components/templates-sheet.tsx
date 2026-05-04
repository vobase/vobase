import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { channelsClient } from '@/lib/api-client'
import { TemplatesTable } from './templates-table'

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

interface TemplatesSheetProps {
  instanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TemplatesSheet({ instanceId, open, onOpenChange }: TemplatesSheetProps) {
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const { data: instance } = useQuery({
    queryKey: ['channels', 'instance', instanceId],
    queryFn: () => fetchInstance(instanceId),
    enabled: open,
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[640px] flex-col sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{instance?.displayName ? `${instance.displayName} — Templates` : 'Message Templates'}</SheetTitle>
          <SheetDescription>Read-only mirror of templates synced from Meta WABA Manager.</SheetDescription>
        </SheetHeader>
        <div className="mt-2 flex items-center gap-2">
          {wabaId && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${wabaId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1.5"
              >
                <ExternalLink className="size-3.5" />
                Open in Meta WABA Manager
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1.5">
            <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync from Meta
          </Button>
        </div>
        <div className="mt-4 flex-1 overflow-auto">
          <TemplatesTable instanceId={instanceId} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
