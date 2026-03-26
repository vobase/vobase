import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { BotIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';
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
import { sessionsTableSchema } from '../../lib/table-schemas';

// ─── Types ────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  model?: string;
  channels?: string[];
}

interface Session {
  id: string;
  agentId: string;
  contactId: string;
  channelInstanceId: string;
  endpointId: string;
  status: string;
  sessionType: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

interface AgentStats {
  total: number;
  failed: number;
  consultations: number;
  errorRate: number;
}

// ─── Data fetchers (agents + stats remain separate) ──────────────────

async function fetchAgents(): Promise<Agent[]> {
  const res = await conversationsClient.agents.$get();
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchStats(): Promise<Record<string, AgentStats>> {
  const res = await conversationsClient.stats.$get();
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

async function pauseSession(sessionId: string): Promise<void> {
  const res = await conversationsClient.sessions[':id'].$patch(
    { param: { id: sessionId } },
    {
      init: {
        body: JSON.stringify({ status: 'paused' }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to pause session');
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ─── Schema-driven generation ────────────────────────────────────────

const filterFields = generateFilterFields<Session>(sessionsTableSchema);
const filterSchema = generateFilterSchema(sessionsTableSchema, {
  sort: field.sort(),
});
const defaultColumnVisibility = getDefaultColumnVisibility(sessionsTableSchema);

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

const sessionsQueryOptions = createDataTableQueryOptions<Session[], unknown>({
  queryKeyPrefix: 'sessions-table',
  apiEndpoint: '/api/conversations/sessions-table/data',
  searchParamsSerializer,
});

// ─── Columns ─────────────────────────────────────────────────────────

function getColumns(
  agents: Agent[],
  pauseMutation: { mutate: (id: string) => void; isPending: boolean },
  retryMutation: { mutate: (id: string) => void; isPending: boolean },
): ColumnDef<Session>[] {
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
        const session = row.original;
        return (
          <div className="flex items-center gap-2">
            <Link
              to="/conversations/sessions/$sessionId"
              params={{ sessionId: session.id }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View
            </Link>
            {session.status === 'active' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                disabled={pauseMutation.isPending}
                onClick={() => pauseMutation.mutate(session.id)}
              >
                Pause
              </Button>
            )}
            {session.status === 'failed' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate(session.id)}
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

function SessionsTableInner({
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
    () => sessionsQueryOptions(search as Record<string, unknown>),
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

  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['conversations-agents'],
    queryFn: fetchAgents,
  });

  const { data: stats = {} } = useQuery({
    queryKey: ['conversations-stats'],
    queryFn: fetchStats,
  });

  // Fetch all sessions client-side only for agent card counts
  const { data: allSessions = [] } = useQuery<Session[]>({
    queryKey: ['conversations-sessions'],
    queryFn: async () => {
      const res = await conversationsClient.sessions.$get();
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json() as unknown as Session[];
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions-table'] });
      queryClient.invalidateQueries({ queryKey: ['conversations-sessions'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: retryOutboxMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions-table'] });
      queryClient.invalidateQueries({ queryKey: ['conversations-sessions'] });
    },
  });

  const adapter = useMemoryAdapter(filterSchema.definition);

  function agentSessionCount(agentId: string, status?: string) {
    return allSessions.filter(
      (s) => s.agentId === agentId && (status ? s.status === status : true),
    ).length;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Conversations</h2>
        <p className="text-sm text-muted-foreground">
          Overview of active AI agents and conversations
        </p>
      </div>

      {agentsLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      )}

      {/* Agent cards */}
      {!agentsLoading && agents.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            AI Agents
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const active = agentSessionCount(agent.id, 'active');
              const completed = agentSessionCount(agent.id, 'completed');
              const agentStats = stats[agent.id];

              return (
                <Card key={agent.id} size="sm">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                        <BotIcon className="h-4 w-4 text-primary" />
                      </div>
                      <CardTitle className="text-sm">{agent.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">
                          {active}
                        </span>{' '}
                        active
                      </span>
                      <span>
                        <span className="font-medium text-foreground">
                          {completed}
                        </span>{' '}
                        completed
                      </span>
                      {agentStats && (
                        <>
                          <span className="flex items-center gap-1">
                            <UsersIcon className="h-3 w-3" />
                            <span className="font-medium text-foreground">
                              {agentStats.consultations}
                            </span>{' '}
                            escalations
                          </span>
                          <span>
                            error rate{' '}
                            <span
                              className={`font-medium ${agentStats.errorRate > 0.1 ? 'text-destructive' : 'text-foreground'}`}
                            >
                              {formatPercent(agentStats.errorRate)}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Conversations table */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Conversations
        </h2>
        <DataTableStoreProvider adapter={adapter}>
          <SessionsTableInner
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
