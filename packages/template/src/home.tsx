import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Bot,
  Database,
  FileText,
  Heart,
  MessageSquare,
  Package,
  Search,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { systemClient } from '@/lib/api-client';

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

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

const quickLinks = [
  {
    label: 'Messaging',
    description: 'AI chat threads with KB-powered agents',
    to: '/messaging/threads' as const,
    icon: MessageSquare,
  },
  {
    label: 'Agents',
    description: 'Manage agent configurations',
    to: '/messaging/agents' as const,
    icon: Bot,
  },
  {
    label: 'Knowledge Base',
    description: 'Search and manage knowledge documents',
    to: '/knowledge-base/search' as const,
    icon: Search,
  },
  {
    label: 'Documents',
    description: 'Upload and process source documents',
    to: '/knowledge-base/documents' as const,
    icon: FileText,
  },
];

export function HomePage() {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  const infoQuery = useQuery({
    queryKey: ['system-info'],
    queryFn: fetchSystemInfo,
  });

  const auditQuery = useQuery({
    queryKey: ['system-audit', 'recent'],
    queryFn: fetchRecentAudit,
  });

  const recentEntries = (auditQuery.data?.entries ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <PageHeader title="Dashboard" />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Heart}
          label="System Health"
          value={
            healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data.status ?? '—')
          }
        />
        <StatCard
          icon={Database}
          label="Database"
          value={
            healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data.db ?? '—')
          }
        />
        <StatCard
          icon={Package}
          label="Modules"
          value={
            infoQuery.isPending
              ? '—'
              : infoQuery.isError
                ? 'Unavailable'
                : infoQuery.data.modules.length
          }
        />
      </div>

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

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Quick Links
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((link) => (
            <Link key={link.to} to={link.to}>
              <Card size="sm" className="h-full transition-colors hover:bg-muted/50">
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
