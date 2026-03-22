import { useQuery } from '@tanstack/react-query';
import {
  CheckCircleIcon,
  LoaderIcon,
  PauseCircleIcon,
  XCircleIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface WorkflowRun {
  id: string;
  workflowId: string;
  status: string;
  inputData: Record<string, unknown> | null;
  suspendPayload: Record<string, unknown> | null;
  outputData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchRuns(
  workflowId: string,
  cursor: string | null,
  limit: number,
): Promise<{ runs: WorkflowRun[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(
    `/api/ai/workflows/${encodeURIComponent(workflowId)}/runs?${params}`,
  );
  if (!res.ok) throw new Error('Failed to fetch workflow runs');
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

const statusConfig: Record<
  string,
  {
    icon: typeof CheckCircleIcon;
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    className: string;
  }
> = {
  running: {
    icon: LoaderIcon,
    label: 'Running',
    variant: 'default',
    className: 'text-blue-600 bg-blue-500/10 border-blue-300',
  },
  suspended: {
    icon: PauseCircleIcon,
    label: 'Awaiting action',
    variant: 'outline',
    className: 'text-amber-600 bg-amber-500/10 border-amber-300',
  },
  completed: {
    icon: CheckCircleIcon,
    label: 'Completed',
    variant: 'outline',
    className: 'text-green-600 bg-green-500/10 border-green-300',
  },
  failed: {
    icon: XCircleIcon,
    label: 'Failed',
    variant: 'destructive',
    className: 'text-red-600 bg-red-500/10 border-red-300',
  },
};

interface WorkflowRunHistoryProps {
  workflowId: string;
  onSelectRun: (run: WorkflowRun) => void;
}

export type { WorkflowRun };

export function WorkflowRunHistory({
  workflowId,
  onSelectRun,
}: WorkflowRunHistoryProps) {
  const [allRuns, setAllRuns] = useState<WorkflowRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const { isLoading, isError } = useQuery({
    queryKey: ['workflow-runs', workflowId, cursor],
    queryFn: async () => {
      const result = await fetchRuns(workflowId, cursor, 10);
      setAllRuns((prev) => (cursor ? [...prev, ...result.runs] : result.runs));
      setHasMore(result.nextCursor !== null);
      return result;
    },
  });

  if (isLoading && allRuns.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Failed to load run history.</p>
    );
  }

  if (allRuns.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-xs text-muted-foreground">
          No runs yet for this workflow
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {allRuns.map((run) => {
        const config = statusConfig[run.status] ?? statusConfig.running;
        const Icon = config.icon;

        return (
          <button
            key={run.id}
            type="button"
            onClick={() => onSelectRun(run)}
            className="flex items-center justify-between gap-3 w-full rounded-lg border p-2.5 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Icon
                className={`size-4 shrink-0 ${config.className.split(' ')[0]}`}
              />
              <Badge
                variant={config.variant}
                className={`text-xs ${config.className}`}
              >
                {config.label}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono truncate">
                {run.id.slice(0, 8)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatRelativeTime(run.createdAt)}
            </span>
          </button>
        );
      })}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={isLoading}
          onClick={() => {
            const last = allRuns[allRuns.length - 1];
            if (last) setCursor(`${last.createdAt}_${last.id}`);
          }}
        >
          {isLoading ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
