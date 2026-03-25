import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ActivityIcon,
  BotIcon,
  CheckCircleIcon,
  CircleAlertIcon,
  ClockIcon,
  PauseCircleIcon,
  RefreshCwIcon,
  UsersIcon,
} from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  model?: string;
  channels?: string[];
}

interface Session {
  id: string;
  agentId: string | null;
  contactId: string | null;
  channel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentStats {
  total: number;
  failed: number;
  consultations: number;
  errorRate: number;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/conversations/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchSessions(): Promise<Session[]> {
  const res = await fetch('/api/conversations/sessions');
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

async function fetchStats(): Promise<Record<string, AgentStats>> {
  const res = await fetch('/api/conversations/stats');
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

async function pauseSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/conversations/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paused' }),
  });
  if (!res.ok) throw new Error('Failed to pause session');
}

async function retryOutboxMessage(outboxId: string): Promise<void> {
  const res = await fetch(`/api/conversations/outbox/${outboxId}/retry`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to retry message');
}

// ─── Helpers ──────────────────────────────────────────────────────────

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'paused') return 'outline';
  return 'secondary';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'active')
    return <ActivityIcon className="h-3.5 w-3.5 text-primary" />;
  if (status === 'completed')
    return <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === 'failed')
    return <CircleAlertIcon className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'paused')
    return <PauseCircleIcon className="h-3.5 w-3.5 text-muted-foreground" />;
  return <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ─── Page ─────────────────────────────────────────────────────────────

function DashboardPage() {
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();

  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['conversations-agents'],
    queryFn: fetchAgents,
  });

  const { data: allSessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['conversations-sessions'],
    queryFn: fetchSessions,
  });

  const { data: stats = {} } = useQuery({
    queryKey: ['conversations-stats'],
    queryFn: fetchStats,
  });

  const pauseMutation = useMutation({
    mutationFn: pauseSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations-sessions'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: retryOutboxMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations-sessions'] });
    },
  });

  const isLoading = agentsLoading || sessionsLoading;

  // Filter sessions by selected agent
  const displaySessions = selectedAgentId
    ? allSessions.filter((s) => s.agentId === selectedAgentId)
    : allSessions;

  // Per-agent counts from live sessions
  function agentSessionCount(agentId: string, status?: string) {
    return allSessions.filter(
      (s) => s.agentId === agentId && (status ? s.status === status : true),
    ).length;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Agent Dashboard" />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      )}

      {/* Agent cards */}
      {!isLoading && agents.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Agents
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const active = agentSessionCount(agent.id, 'active');
              const completed = agentSessionCount(agent.id, 'completed');
              const agentStats = stats[agent.id];
              const isSelected = selectedAgentId === agent.id;

              return (
                <Card
                  key={agent.id}
                  size="sm"
                  className={`cursor-pointer transition-colors ${isSelected ? 'ring-1 ring-primary' : 'hover:bg-muted/50'}`}
                  onClick={() =>
                    setSelectedAgentId(isSelected ? undefined : agent.id)
                  }
                >
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
                            consultations
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

      {/* Sessions table */}
      {!isLoading && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {selectedAgentId
                ? `Sessions — ${agents.find((a) => a.id === selectedAgentId)?.name ?? selectedAgentId}`
                : 'All Sessions'}
            </h2>
            {selectedAgentId && (
              <button
                type="button"
                onClick={() => setSelectedAgentId(undefined)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear filter
              </button>
            )}
          </div>

          {displaySessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No sessions found.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                      Channel
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                      Agent
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                      Started
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displaySessions.map((session) => (
                    <tr
                      key={session.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={session.status} />
                          <Badge
                            variant={statusVariant(session.status)}
                            className="capitalize text-xs"
                          >
                            {session.status}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {session.channel}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {session.agentId ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(session.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            to="/dashboard/$sessionId"
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/dashboard/overview')({
  component: DashboardPage,
});
