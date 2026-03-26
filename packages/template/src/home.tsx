import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ActivityIcon,
  BotIcon,
  ContactIcon,
  FileText,
  Heart,
  RadioIcon,
  Search,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { systemClient } from '@/lib/api-client';

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchHealth() {
  const response = await systemClient.health.$get();
  if (!response.ok) throw new Error('Health endpoint failed');
  return response.json();
}

async function fetchSystemInfo() {
  const response = await systemClient.index.$get();
  if (!response.ok) throw new Error('System info failed');
  return response.json();
}

async function fetchRecentAudit() {
  const response = await systemClient['audit-log'].$get();
  if (!response.ok) throw new Error('Audit log failed');
  return response.json();
}

interface Agent {
  id: string;
  name: string;
}

interface Session {
  id: string;
  agentId: string;
  status: string;
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await globalThis.fetch('/api/conversations/agents');
  if (!res.ok) return [];
  return res.json();
}

async function fetchSessions(): Promise<Session[]> {
  const res = await globalThis.fetch('/api/conversations/sessions');
  if (!res.ok) return [];
  return res.json();
}

async function fetchContactCount(): Promise<number> {
  try {
    const res = await globalThis.fetch(
      '/api/conversations/contacts-table/data?limit=1',
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return data?.meta?.totalRowCount ?? 0;
  } catch {
    return 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

// ─── Quick links ─────────────────────────────────────────────────────

const quickLinks = [
  {
    label: 'Conversations',
    description: 'Monitor active conversations',
    to: '/conversations/sessions/overview' as const,
    icon: ActivityIcon,
  },
  {
    label: 'Contacts',
    description: 'Browse customer and staff directory',
    to: '/conversations/contacts' as const,
    icon: ContactIcon,
  },
  {
    label: 'Channels',
    description: 'Manage channel instances and endpoints',
    to: '/conversations/channels' as const,
    icon: RadioIcon,
  },
  {
    label: 'AI Agents',
    description: 'View AI agent configurations',
    to: '/conversations/ai/agents' as const,
    icon: BotIcon,
  },
  {
    label: 'Knowledge Base',
    description: 'Search knowledge documents',
    to: '/knowledge-base/search' as const,
    icon: Search,
  },
  {
    label: 'Documents',
    description: 'Upload and manage source documents',
    to: '/knowledge-base/documents' as const,
    icon: FileText,
  },
];

// ─── Page ─────────────────────────────────────────────────────────────

export function HomePage() {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  const _infoQuery = useQuery({
    queryKey: ['system-info'],
    queryFn: fetchSystemInfo,
  });

  const auditQuery = useQuery({
    queryKey: ['system-audit', 'recent'],
    queryFn: fetchRecentAudit,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['conversations-agents'],
    queryFn: fetchAgents,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['conversations-sessions'],
    queryFn: fetchSessions,
  });

  const { data: contactCount = 0 } = useQuery({
    queryKey: ['contacts-count'],
    queryFn: fetchContactCount,
  });

  const activeSessions = sessions.filter((s) => s.status === 'active').length;
  const recentEntries = (auditQuery.data?.entries ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <PageHeader title="Dashboard" />

      {/* Primary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ActivityIcon}
          label="Active Conversations"
          value={activeSessions}
        />
        <StatCard icon={BotIcon} label="AI Agents" value={agents.length} />
        <StatCard icon={ContactIcon} label="Contacts" value={contactCount} />
        <StatCard
          icon={Heart}
          label="System"
          value={
            healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data.status ?? '—')
          }
        />
      </div>

      {/* AI Agent breakdown */}
      {agents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              AI Agent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => {
                const agentSessions = sessions.filter(
                  (s) => s.agentId === agent.id,
                );
                const active = agentSessions.filter(
                  (s) => s.status === 'active',
                ).length;
                const completed = agentSessions.filter(
                  (s) => s.status === 'completed',
                ).length;
                const failed = agentSessions.filter(
                  (s) => s.status === 'failed',
                ).length;

                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                      <BotIcon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {agent.name}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
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
                          done
                        </span>
                        {failed > 0 && (
                          <span>
                            <span className="font-medium text-destructive">
                              {failed}
                            </span>{' '}
                            failed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {auditQuery.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : auditQuery.isError ? (
            <p className="text-sm text-destructive">
              Unable to load recent activity.
            </p>
          ) : recentEntries.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs font-medium text-muted-foreground">
                      <th className="pb-2 pr-4">Event</th>
                      <th className="pb-2 pr-4">Actor</th>
                      <th className="pb-2">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEntries.map((entry, index) => (
                      <tr
                        key={entry.id ?? `${entry.event}-${index}`}
                        className="border-b last:border-0"
                      >
                        <td className="py-2.5 pr-4 font-medium">
                          {entry.event}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {entry.actorEmail ?? 'System'}
                        </td>
                        <td className="py-2.5 text-muted-foreground">
                          {formatTimestamp(entry.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Separator className="my-4" />
              <Link
                to="/system/logs"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                View all audit logs &rarr;
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Quick Links
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((link) => (
            <Link key={link.to} to={link.to}>
              <Card
                size="sm"
                className="h-full transition-colors hover:bg-muted/50"
              >
                <CardContent>
                  <link.icon className="mb-2 h-4 w-4 text-muted-foreground" />
                  <p className="font-medium text-sm">{link.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {link.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});
