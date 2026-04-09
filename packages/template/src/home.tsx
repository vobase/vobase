import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  MessageSquare,
  Shield,
  Wrench,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type RealtimeStatus, useRealtimeStatus } from '@/hooks/use-realtime';
import { aiClient } from '@/lib/api-client';

// ─── Data fetchers ────────────────────────────────────────────────────

async function fetchDashboard() {
  const res = await aiClient.dashboard.$get();
  if (!res.ok) throw new Error('Dashboard endpoint failed');
  return res.json();
}

async function fetchAgentMetrics() {
  const res = await aiClient.agents.metrics.$get();
  if (!res.ok) throw new Error('Agent metrics endpoint failed');
  return res.json();
}

async function fetchAttention() {
  const res = await aiClient.attention.$get();
  if (!res.ok) throw new Error('Attention endpoint failed');
  return res.json();
}

async function fetchActivity({ pageParam }: { pageParam: string | undefined }) {
  const query: Record<string, string> = { limit: '15' };
  if (pageParam) query.cursor = pageParam;
  const res = await aiClient.activity.$get({ query });
  if (!res.ok) throw new Error('Activity endpoint failed');
  return res.json();
}

async function fetchContacts(): Promise<{ id: string; name: string | null }[]> {
  const res = await aiClient.contacts.$get();
  if (!res.ok) return [];
  const body = await res.json();
  if (Array.isArray(body)) return body as { id: string; name: string | null }[];
  const wrapper = body as unknown as {
    data: { id: string; name: string | null }[];
  };
  return wrapper.data ?? [];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatResponseTime(ms: number): string {
  if (!ms) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function waitingMinutes(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return '<1 min';
  return `${mins} min`;
}

function successScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 50) return 'text-orange-500 dark:text-orange-400';
  return 'text-destructive';
}

interface ActivityEventData {
  reason?: string;
  toolName?: string;
  mode?: string;
  [key: string]: unknown;
}

function eventIcon(type: string) {
  if (type.startsWith('session.completed') || type === 'attention.reviewed')
    return CheckCircle;
  if (type.startsWith('escalation') || type === 'session.failed')
    return AlertTriangle;
  if (type.startsWith('guardrail')) return Shield;
  if (type === 'agent.tool_executed') return Wrench;
  if (type === 'handler.changed') return ArrowRight;
  return MessageSquare;
}

const STATUS_DOT: Record<RealtimeStatus, { color: string; animate: boolean }> =
  {
    connected: { color: 'bg-green-500', animate: true },
    connecting: { color: 'bg-amber-500', animate: true },
    disconnected: { color: 'bg-red-500', animate: false },
  };

function RealtimeDot({ status }: { status: RealtimeStatus }) {
  const { color, animate } = STATUS_DOT[status];
  return (
    <span className="relative flex h-2 w-2">
      {animate && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventDescription(
  type: string,
  agentId: string | null,
  contactId: string | null,
  data: ActivityEventData,
  agentNames: Map<string, string>,
  contactNames: Map<string, string>,
) {
  const agent = (agentId && agentNames.get(agentId)) ?? 'Agent';
  const contact =
    (contactId && contactNames.get(contactId)) ?? contactId ?? 'a visitor';

  const n = 'font-medium text-foreground'; // names (bold, black/white)
  const v = 'text-muted-foreground'; // verbs & connectors (gray)

  switch (type) {
    case 'session.created':
      return (
        <>
          <span className={n}>{agent}</span>
          <span className={v}> started an interaction with </span>
          <span className={n}>{contact}</span>
        </>
      );
    case 'session.completed':
      return (
        <>
          <span className={n}>{agent}</span>
          <span className={v}> resolved </span>
          <span className={n}>{contact}</span>
          <span className={v}>'s inquiry</span>
        </>
      );
    case 'session.failed':
      return (
        <>
          <span className={n}>{agent}</span>
          <span className={v}> failed handling </span>
          <span className={n}>{contact}</span>
        </>
      );
    case 'escalation.created':
      return (
        <>
          <span className={n}>{agent}</span>{' '}
          <span className="font-medium text-destructive">escalated</span>{' '}
          <span className={n}>{contact}</span>
          {data.reason && (
            <span className={v}>
              {' '}
              —{' '}
              {data.reason.length > 60
                ? `${data.reason.slice(0, 60)}…`
                : data.reason}
            </span>
          )}
        </>
      );
    case 'guardrail.block':
      return (
        <>
          <span className={v}>Guardrail blocked a message from </span>
          <span className={n}>{contact}</span>
        </>
      );
    case 'agent.tool_executed':
      return (
        <>
          <span className={n}>{agent}</span>
          <span className={v}> used </span>
          <span className={n}>
            {data.toolName ? formatToolName(data.toolName) : 'a tool'}
          </span>
          <span className={v}> for </span>
          <span className={n}>{contact}</span>
        </>
      );
    case 'attention.reviewed':
      return (
        <>
          <span className={n}>{contact}</span>
          <span className={v}>'s escalation was reviewed</span>
        </>
      );
    case 'attention.dismissed':
      return (
        <>
          <span className={n}>{contact}</span>
          <span className={v}>'s escalation was dismissed</span>
        </>
      );
    case 'handler.changed':
      return (
        <>
          <span className={n}>{contact}</span>
          <span className={v}>'s session handed to </span>
          <span className={n}>{data.mode ?? 'another mode'}</span>
        </>
      );
    case 'message.outbound_queued':
      return (
        <>
          <span className={v}>Message queued for </span>
          <span className={n}>{contact}</span>
        </>
      );
    case 'message.inbound_human_mode':
      return (
        <>
          <span className={n}>{contact}</span>
          <span className={v}> sent a message (human mode)</span>
        </>
      );
    case 'guardrail.warn':
      return (
        <>
          <span className={v}>Guardrail warning for </span>
          <span className={n}>{contact}</span>
        </>
      );
    case 'agent.draft_generated':
      return (
        <>
          <span className={n}>{agent}</span>
          <span className={v}> drafted a response for </span>
          <span className={n}>{contact}</span>
        </>
      );
    default:
      return <span className="text-muted-foreground">{type}</span>;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────

function HomePage() {
  const queryClient = useQueryClient();

  const dashboardQuery = useQuery({
    queryKey: ['interactions-dashboard'],
    queryFn: fetchDashboard,
  });

  const metricsQuery = useQuery({
    queryKey: ['interactions-metrics'],
    queryFn: fetchAgentMetrics,
  });

  const attentionQuery = useQuery({
    queryKey: ['interactions-attention'],
    queryFn: fetchAttention,
  });

  const contactsQuery = useQuery({
    queryKey: ['interactions-contacts'],
    queryFn: fetchContacts,
  });

  const activityQuery = useInfiniteQuery({
    queryKey: ['interactions-activity'],
    queryFn: fetchActivity,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const reviewMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const res = await aiClient.attention[':eventId'].review.$post({
        param: { eventId },
      });
      if (!res.ok) throw new Error('Review failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interactions-attention'] });
      queryClient.invalidateQueries({ queryKey: ['interactions-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['interactions-activity'] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const res = await aiClient.attention[':eventId'].dismiss.$post({
        param: { eventId },
      });
      if (!res.ok) throw new Error('Dismiss failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interactions-attention'] });
      queryClient.invalidateQueries({ queryKey: ['interactions-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['interactions-activity'] });
    },
  });

  const dashboard = dashboardQuery.data;
  const agents = metricsQuery.data?.agents ?? [];
  const attentionItems = attentionQuery.data?.items ?? [];
  const attentionCount = attentionQuery.data?.count ?? 0;
  const allEvents =
    activityQuery.data?.pages.flatMap((page) => page.events) ?? [];
  const hasAttention = attentionCount > 0;
  const realtimeStatus = useRealtimeStatus();

  const agentNames = new Map(agents.map((a) => [a.agentId, a.name]));
  const contactNames = new Map(
    (contactsQuery.data ?? [])
      .filter((c) => c.name)
      .map((c) => [c.id, c.name as string]),
  );

  return (
    <div className="flex flex-col gap-8 p-6 lg:p-10">
      {/* ── Hero Metric Section ─────────────────────────────────── */}
      <div>
        {dashboardQuery.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-6xl font-black tracking-tight">
                {dashboard?.needsAttentionCount ?? 0}
              </span>
              <span className="text-lg text-muted-foreground">
                need your attention
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{dashboard?.activeSessions ?? 0} active</span>
              <span>&middot;</span>
              <span>{dashboard?.resolvedToday ?? 0} resolved today</span>
              <span>&middot;</span>
              <span>
                {formatResponseTime(dashboard?.avgResponseTimeMs ?? 0)} avg
                response
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Two-Column Layout ───────────────────────────────────── */}
      <div
        className={`grid gap-6 ${hasAttention ? 'lg:grid-cols-[1fr_42%]' : ''}`}
      >
        {/* Left: Activity Feed */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <RealtimeDot status={realtimeStatus} />
            Activity
          </h2>
          <div className="flex flex-col">
            {activityQuery.isPending ? (
              ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((k) => (
                <div key={k} className="flex h-11 items-center gap-3 px-2">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-8" />
                </div>
              ))
            ) : allEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No activity yet
              </p>
            ) : (
              <>
                {allEvents.map((event) => {
                  const eventType = event.content;
                  const eventData = (event.contentData ??
                    {}) as ActivityEventData;
                  const eventAgentId =
                    (eventData.agentId as string | null) ?? null;
                  const eventContactId =
                    (eventData.contactId as string | null) ?? null;
                  const Icon = eventIcon(eventType);
                  return (
                    <div
                      key={event.id}
                      className="group flex h-11 items-center gap-3 rounded-md px-2 hover:bg-muted/30"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {eventDescription(
                          eventType,
                          eventAgentId,
                          eventContactId,
                          eventData,
                          agentNames,
                          contactNames,
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {event.interactionId ? (
                          <Link
                            to="/interactions/$interactionId"
                            params={{ interactionId: event.interactionId }}
                            className="hidden text-xs text-muted-foreground hover:text-foreground group-hover:inline"
                          >
                            View &rarr;
                          </Link>
                        ) : null}
                        <span
                          className={
                            event.interactionId ? 'group-hover:hidden' : ''
                          }
                        >
                          {relativeTime(event.createdAt)}
                        </span>
                      </span>
                    </div>
                  );
                })}
                {activityQuery.hasNextPage && (
                  <button
                    type="button"
                    onClick={() => activityQuery.fetchNextPage()}
                    disabled={activityQuery.isFetchingNextPage}
                    className="mt-2 px-2 text-left text-sm text-muted-foreground hover:text-foreground"
                  >
                    {activityQuery.isFetchingNextPage
                      ? 'Loading...'
                      : 'Show more'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Attention Queue */}
        {hasAttention && (
          <div className="rounded-xl bg-muted/30 p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Attention
              </span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
                {attentionCount}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {attentionQuery.isPending
                ? ['b1', 'b2', 'b3'].map((k) => (
                    <Skeleton key={k} className="h-28 rounded-xl" />
                  ))
                : attentionItems.map((item) => {
                    const itemData = (item.contentData ??
                      {}) as ActivityEventData;
                    const itemContactId =
                      (itemData.contactId as string | null) ?? null;
                    const itemAgentId =
                      (itemData.agentId as string | null) ?? null;
                    const isEscalation = item.content === 'escalation.created';
                    const borderColor = isEscalation
                      ? 'border-l-blue-500'
                      : 'border-l-destructive';
                    const contactName =
                      (itemContactId && contactNames.get(itemContactId)) ??
                      itemContactId ??
                      'Anonymous';
                    const isPending =
                      reviewMutation.isPending || dismissMutation.isPending;

                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border-l-[3px] bg-background p-4 ${borderColor}`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-sm font-medium">
                            {contactName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Waiting {waitingMinutes(item.createdAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {item.channelType ?? 'web'} &middot;{' '}
                          {(itemAgentId && agentNames.get(itemAgentId)) ??
                            itemAgentId ??
                            'Unknown agent'}
                        </p>
                        {itemData.reason && (
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                            {String(itemData.reason)}
                          </p>
                        )}
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-sm"
                            disabled={isPending}
                            onClick={() => reviewMutation.mutate(item.id)}
                          >
                            Review
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-sm"
                            disabled={isPending}
                            onClick={() => dismissMutation.mutate(item.id)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>
        )}
      </div>

      {/* ── Agent Row ───────────────────────────────────────────── */}
      {(metricsQuery.isPending || agents.length > 0) && (
        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Agents
          </h2>
          {metricsQuery.isPending ? (
            <div className="flex gap-4 overflow-x-auto">
              {['c1', 'c2', 'c3', 'c4'].map((k) => (
                <Skeleton key={k} className="h-16 w-40 shrink-0 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto">
              {agents.map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2"
                >
                  <div className="relative">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.activeCount} active &middot;{' '}
                      <span
                        className={successScoreColor(
                          Math.round(agent.successScore * 100),
                        )}
                      >
                        {Math.round(agent.successScore * 100)}%
                      </span>{' '}
                      success
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/interactions' });
  },
  component: HomePage,
});
