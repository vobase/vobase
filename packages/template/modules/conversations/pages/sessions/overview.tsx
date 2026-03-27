import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { BotIcon, RefreshCwIcon } from 'lucide-react';
import { useMemo } from 'react';

import {
  DataTableCellBadge,
  DataTableCellText,
  DataTableCellTimestamp,
} from '@/components/data-table/data-table-cell';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableInfinite } from '@/components/data-table/data-table-infinite';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { conversationsClient } from '@/lib/api-client';
import {
  createDataTableQueryOptions,
  getFacetedMinMaxValues,
  getFacetedUniqueValues,
} from '@/lib/data-table';
import { useMemoryAdapter } from '@/lib/store/adapters/memory';
import { useFilterState } from '@/lib/store/hooks/useFilterState';
import { DataTableStoreProvider } from '@/lib/store/provider/DataTableStoreProvider';
import { field } from '@/lib/store/schema/field';
import {
  generateFilterFields,
  generateFilterSchema,
  getDefaultColumnVisibility,
} from '@/lib/table-schema';
import { conversationsTableSchema } from '../../lib/table-schemas';

// ─── Types ────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  model?: string;
  channels?: string[];
}

interface Conversation {
  id: string;
  agentId: string;
  contactId: string;
  channelInstanceId: string;
  channelRoutingId: string;
  status: string;
  conversationType: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

interface AgentMetric {
  agentId: string;
  name: string;
  model: string;
  channels: string[];
  activeCount: number;
  queuedCount: number;
  successScore: number;
}

// ─── Data fetchers ────────────────────────────────────────────────────

async function fetchAgents(): Promise<Agent[]> {
  const res = await conversationsClient.agents.$get();
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchAgentMetrics(): Promise<{ agents: AgentMetric[] }> {
  const res = await conversationsClient.agents.metrics.$get();
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json() as unknown as Promise<{ agents: AgentMetric[] }>;
}

async function pauseConversation(conversationId: string): Promise<void> {
  const res = await conversationsClient.conversations[':id'].$patch(
    { param: { id: conversationId } },
    {
      init: {
        body: JSON.stringify({ status: 'paused' }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to pause conversation');
}

async function retryOutboxMessage(outboxId: string): Promise<void> {
  const res = await conversationsClient.outbox[':id'].retry.$post({
    param: { id: outboxId },
  });
  if (!res.ok) throw new Error('Failed to retry message');
}

// ─── Helpers ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  paused: '#6b7280',
};

function deriveChannel(channelInstanceId: string): string {
  if (channelInstanceId.startsWith('ci-wa-')) return 'whatsapp';
  if (channelInstanceId.startsWith('ci-web')) return 'web';
  return channelInstanceId;
}

// ─── Schema-driven generation ────────────────────────────────────────

const filterFields = generateFilterFields<Conversation>(
  conversationsTableSchema,
);
const filterSchema = generateFilterSchema(conversationsTableSchema, {
  sort: field.sort(),
});
const defaultColumnVisibility = getDefaultColumnVisibility(
  conversationsTableSchema,
);

// ─── Search params serializer ────────────────────────────────────────

const searchParamsSerializer = (search: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value[0] instanceof Date) {
        params.set(key, value.map((d: Date) => d.getTime()).join(','));
      } else {
        params.set(key, value.join(','));
      }
    } else if (typeof value === 'object' && value !== null && 'id' in value) {
      const sort = value as { id: string; desc: boolean };
      params.set(key, `${sort.id}.${sort.desc ? 'desc' : 'asc'}`);
    } else if (value instanceof Date) {
      params.set(key, String(value.getTime()));
    } else {
      params.set(key, String(value));
    }
  }
  return `?${params.toString()}`;
};

// ─── Query options factory ───────────────────────────────────────────

const conversationsQueryOptions = createDataTableQueryOptions<
  Conversation[],
  unknown
>({
  queryKeyPrefix: 'conversations-table',
  apiEndpoint: '/api/conversations/conversations-table/data',
  searchParamsSerializer,
});

// ─── Columns ─────────────────────────────────────────────────────────

function getColumns(
  agents: Agent[],
  pauseMutation: { mutate: (id: string) => void; isPending: boolean },
  retryMutation: { mutate: (id: string) => void; isPending: boolean },
): ColumnDef<Conversation>[] {
  const agentMap = new Map(agents.map((a) => [a.id, a.name]));

  return [
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const status = row.getValue<string>('status');
        return (
          <DataTableCellBadge value={status} color={STATUS_COLORS[status]} />
        );
      },
      enableSorting: true,
      meta: { label: 'Status' },
    },
    {
      accessorKey: 'agentId',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="AI Agent" />
      ),
      cell: ({ row }) => {
        const agentId = row.getValue<string>('agentId');
        return <DataTableCellText value={agentMap.get(agentId) ?? agentId} />;
      },
      enableSorting: true,
      meta: { label: 'AI Agent' },
    },
    {
      id: 'channel',
      accessorFn: (row) => deriveChannel(row.channelInstanceId),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Channel" />
      ),
      cell: ({ row }) => {
        const channel = row.getValue<string>('channel');
        return <DataTableCellText value={channel} />;
      },
      meta: { label: 'Channel' },
    },
    {
      accessorKey: 'startedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Started" />
      ),
      cell: ({ row }) => {
        const startedAt = row.getValue<string>('startedAt');
        return <DataTableCellTimestamp date={startedAt} />;
      },
      enableSorting: true,
      meta: { label: 'Started' },
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const conversation = row.original;
        return (
          <div className="flex items-center gap-2">
            <Link
              to="/conversations/sessions/$conversationId"
              params={{ conversationId: conversation.id }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View
            </Link>
            {conversation.status === 'active' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                disabled={pauseMutation.isPending}
                onClick={() => pauseMutation.mutate(conversation.id)}
              >
                Pause
              </Button>
            )}
            {conversation.status === 'failed' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate(conversation.id)}
              >
                <RefreshCwIcon className="mr-1 h-3 w-3" />
                Retry
              </Button>
            )}
          </div>
        );
      },
    },
  ];
}

// ─── Inner table (needs store context for useFilterState) ────────────

function ConversationsTableInner({
  agents,
  pauseMutation,
  retryMutation,
}: {
  agents: Agent[];
  pauseMutation: { mutate: (id: string) => void; isPending: boolean };
  retryMutation: { mutate: (id: string) => void; isPending: boolean };
}) {
  const search = useFilterState();

  const columns = useMemo(
    () => getColumns(agents, pauseMutation, retryMutation),
    [agents, pauseMutation, retryMutation],
  );

  const queryOptions = useMemo(
    () => conversationsQueryOptions(search as Record<string, unknown>),
    [search],
  );

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading, refetch } =
    useInfiniteQuery(queryOptions);

  const flatData = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );
  const lastPage = data?.pages[data.pages.length - 1];
  const facets = lastPage?.meta.facets;

  return (
    <DataTableInfinite
      columns={columns}
      data={flatData}
      filterFields={filterFields}
      defaultColumnVisibility={defaultColumnVisibility}
      fetchNextPage={fetchNextPage}
      hasNextPage={hasNextPage}
      refetch={refetch}
      isFetching={isFetching}
      isLoading={isLoading}
      totalRows={lastPage?.meta.totalRowCount}
      filterRows={lastPage?.meta.filterRowCount}
      totalRowsFetched={flatData.length}
      getFacetedUniqueValues={getFacetedUniqueValues(facets)}
      getFacetedMinMaxValues={getFacetedMinMaxValues(facets)}
      getRowId={(row) => row.id}
      tableId="sessions-overview"
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function DashboardPage() {
  const queryClient = useQueryClient();

  const { data: agents = [] } = useQuery({
    queryKey: ['conversations-agents'],
    queryFn: fetchAgents,
  });

  const { data: metricsData } = useQuery({
    queryKey: ['conversations-metrics'],
    queryFn: fetchAgentMetrics,
  });
  const agentMetrics = metricsData?.agents ?? [];

  const pauseMutation = useMutation({
    mutationFn: pauseConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations-table'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: retryOutboxMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations-table'] });
    },
  });

  const adapter = useMemoryAdapter(filterSchema.definition);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Conversations</h2>
        <p className="text-sm text-muted-foreground">
          Overview of active AI agents and conversations
        </p>
      </div>

      {!metricsData && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      )}

      {/* Agent cards */}
      {agentMetrics.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            AI Agents
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agentMetrics.map((metric) => (
              <Card key={metric.agentId} size="sm">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                      <BotIcon className="h-4 w-4 text-primary" />
                    </div>
                    <CardTitle className="text-sm">{metric.name}</CardTitle>
                    {metric.model && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {metric.model}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground">
                        {metric.activeCount}
                      </span>{' '}
                      active
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        {metric.queuedCount}
                      </span>{' '}
                      queued
                    </span>
                    <span>
                      score{' '}
                      <span
                        className={`font-medium ${
                          metric.successScore >= 0.8
                            ? 'text-green-600 dark:text-green-400'
                            : metric.successScore >= 0.5
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-destructive'
                        }`}
                      >
                        {(metric.successScore * 100).toFixed(0)}%
                      </span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Conversations table */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Conversations
        </h2>
        <DataTableStoreProvider adapter={adapter}>
          <ConversationsTableInner
            agents={agents}
            pauseMutation={pauseMutation}
            retryMutation={retryMutation}
          />
        </DataTableStoreProvider>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/sessions/overview')({
  component: DashboardPage,
});
