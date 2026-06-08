import { useHistorySync } from '@modules/channels/hooks/use-history-sync'
import { Ban, CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { type HistorySync, resolveSyncToast, syncSignature } from './history-sync-toast'

/**
 * Beautiful sonner card for one WhatsApp history import — a spinner + live
 * progress bar while importing, flipping to a success / declined state on
 * completion.
 */
function HistorySyncCard({ sync }: { sync: HistorySync }) {
  const importing = sync.status === 'importing'
  const declined = sync.status === 'declined'
  const pct = Math.max(0, Math.min(100, Math.round(sync.progress)))

  return (
    <div className="flex w-[356px] items-start gap-3 rounded-xl border bg-background p-4 shadow-lg">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          importing && 'bg-primary/10 text-primary',
          !importing && declined && 'bg-amber-500/10 text-amber-600',
          !importing && !declined && 'bg-emerald-500/10 text-emerald-600',
        )}
      >
        {importing ? (
          <Loader2 className="size-5 animate-spin" />
        ) : declined ? (
          <Ban className="size-5" />
        ) : (
          <CheckCircle2 className="size-5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground text-sm">
          {importing ? 'Importing chat history' : declined ? 'History sharing declined' : 'Chat history imported'}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          {sync.displayName ?? 'WhatsApp'}
          {importing ? ` · ${pct}%` : declined ? ' · shared history was turned off' : ' · ready in the inbox'}
        </p>
        {importing && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${Math.max(6, pct)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Headless, app-global watcher: polls history-import status and surfaces a
 * top-right sonner toast per WhatsApp number as its history imports. Renders
 * nothing itself — mounted once in the authenticated app shell.
 */
export function HistorySyncToaster() {
  const { data } = useHistorySync()
  const seen = useRef(new Map<string, string>())

  useEffect(() => {
    for (const sync of data?.syncs ?? []) {
      const action = resolveSyncToast(seen.current.get(sync.instanceId), sync)
      seen.current.set(sync.instanceId, syncSignature(sync))
      if (action === 'none') continue

      const id = `history-sync-${sync.instanceId}`
      const duration = action === 'importing' ? Number.POSITIVE_INFINITY : action === 'done' ? 4000 : 6000
      toast.custom(() => <HistorySyncCard sync={sync} />, { id, duration })
    }
  }, [data])

  return null
}
