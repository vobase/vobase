import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../src/components/ui/card';
import { apiClient } from '../../../src/lib/api-client';

interface SystemInfoResponse {
  version: string;
  uptime: number;
  modules: string[];
}

interface HealthResponse {
  status: string;
  db: string;
  uptime: number;
}

interface AuditEntry {
  id?: string;
  event: string;
  actorEmail: string | null;
  createdAt: string | number | Date;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  nextCursor?: number;
}

async function fetchSystemInfo(): Promise<SystemInfoResponse> {
  const response = await apiClient.api.system.$get();
  if (!response.ok) {
    throw new Error('Failed to fetch system info');
  }

  return (await response.json()) as SystemInfoResponse;
}

async function fetchSystemHealth(): Promise<HealthResponse> {
  const response = await apiClient.api.system.health.$get();
  if (!response.ok) {
    throw new Error('Failed to fetch system health');
  }

  return (await response.json()) as HealthResponse;
}

async function fetchRecentAuditEntries(): Promise<AuditLogResponse> {
  const response = await apiClient.api.system['audit-log'].$get();
  if (!response.ok) {
    throw new Error('Failed to fetch audit log');
  }

  return (await response.json()) as AuditLogResponse;
}

function formatUptime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${hours}h ${minutes}m ${seconds}s`;
}

function formatTimestamp(value: AuditEntry['createdAt']): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleString();
}

export type SystemDashboardPageProps = Record<string, never>;

export function SystemDashboardPage(_: Readonly<SystemDashboardPageProps>) {
  const infoQuery = useQuery({
    queryKey: ['system-info'],
    queryFn: fetchSystemInfo,
  });

  const healthQuery = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
  });

  const auditQuery = useQuery({
    queryKey: ['system-audit', 'recent'],
    queryFn: fetchRecentAuditEntries,
  });

  const modules = infoQuery.data?.modules ?? [];
  const recentEntries = (auditQuery.data?.entries ?? []).slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
          System
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Operations dashboard</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Server version</CardTitle>
            <CardDescription>Current backend release</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {infoQuery.isPending
                ? 'Loading...'
                : infoQuery.isError
                  ? 'Unavailable'
                  : infoQuery.data?.version}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server uptime</CardTitle>
            <CardDescription>
              From /api/system and /api/system/health
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-sm font-medium">
              {infoQuery.isPending
                ? 'Loading...'
                : infoQuery.isError
                  ? 'Unavailable'
                  : formatUptime(infoQuery.data?.uptime ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">
              Health:{' '}
              {healthQuery.isPending
                ? 'Checking...'
                : healthQuery.isError
                  ? 'Unavailable'
                  : healthQuery.data?.status}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Database status</CardTitle>
            <CardDescription>Quick connectivity signal</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {healthQuery.isPending
                ? 'Loading...'
                : healthQuery.isError
                  ? 'Unavailable'
                  : healthQuery.data?.db}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Registered modules</CardTitle>
            <CardDescription>Loaded at runtime</CardDescription>
          </CardHeader>
          <CardContent>
            {infoQuery.isPending ? (
              <p className="text-sm text-muted-foreground">
                Loading modules...
              </p>
            ) : infoQuery.isError ? (
              <p className="text-sm text-destructive">
                Unable to load modules.
              </p>
            ) : modules.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {modules.map((moduleName) => (
                  <li
                    key={moduleName}
                    className="rounded-md border border-border bg-background/80 px-3 py-2"
                  >
                    {moduleName}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No modules reported by the API.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent audit entries</CardTitle>
            <CardDescription>Latest 5 system events</CardDescription>
          </CardHeader>
          <CardContent>
            {auditQuery.isPending ? (
              <p className="text-sm text-muted-foreground">
                Loading audit log...
              </p>
            ) : auditQuery.isError ? (
              <p className="text-sm text-destructive">
                Unable to load audit log.
              </p>
            ) : recentEntries.length > 0 ? (
              <ul className="space-y-3">
                {recentEntries.map((entry, index) => (
                  <li
                    key={entry.id ?? `${entry.event}-${index}`}
                    className="rounded-md border border-border/80 bg-background/80 px-3 py-2"
                  >
                    <p className="text-sm font-medium">{entry.event}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.actorEmail ?? 'Unknown actor'} -{' '}
                      {formatTimestamp(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No audit entries found.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/system/')({
  component: SystemDashboardPage,
});
