import { useQuery } from '@tanstack/react-query';
import { ShieldAlertIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface ModerationLog {
  id: string;
  agentId: string;
  channel: string;
  userId: string | null;
  contactId: string | null;
  conversationId: string | null;
  reason: string;
  blockedContent: string | null;
  matchedTerm: string | null;
  createdAt: string;
}

async function fetchLogs(
  cursor: string | null,
  limit: number,
): Promise<{ logs: ModerationLog[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await globalThis.fetch(`/api/ai/guardrails/logs?${params}`);
  if (!res.ok) throw new Error('Failed to fetch moderation logs');
  return res.json();
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function GuardrailsLogList() {
  const [allLogs, setAllLogs] = useState<ModerationLog[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const { isLoading, isError } = useQuery({
    queryKey: ['guardrails-logs', cursor],
    queryFn: async () => {
      const result = await fetchLogs(cursor, 20);
      setAllLogs((prev) => (cursor ? [...prev, ...result.logs] : result.logs));
      setHasMore(result.nextCursor !== null);
      return result;
    },
  });

  if (isLoading && allLogs.length === 0) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive text-center py-8">
        Failed to load moderation logs.
      </p>
    );
  }

  if (allLogs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <ShieldAlertIcon className="size-8 mb-3 opacity-40" />
        <p className="text-sm">No content has been moderated yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allLogs.map((log) => (
        <div
          key={log.id}
          className="flex items-start justify-between gap-3 rounded-lg border p-3"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={log.reason === 'blocklist' ? 'destructive' : 'default'}
                className="text-xs"
              >
                {log.reason === 'blocklist' ? 'Blocklist' : 'Max Length'}
              </Badge>
              {log.matchedTerm && (
                <Badge variant="outline" className="text-xs font-mono">
                  {log.matchedTerm}
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs capitalize">
                {log.channel}
              </Badge>
            </div>
            {log.blockedContent && (
              <p className="text-xs text-muted-foreground truncate">
                {log.blockedContent}
              </p>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatRelativeTime(log.createdAt)}
          </span>
        </div>
      ))}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={isLoading}
          onClick={() => {
            const last = allLogs[allLogs.length - 1];
            if (last) {
              setCursor(`${last.createdAt}_${last.id}`);
            }
          }}
        >
          {isLoading ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
