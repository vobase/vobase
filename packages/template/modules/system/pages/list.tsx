import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api-client';

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
    <div className="flex flex-col gap-8 p-6 lg:p-10">
      <div>
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          System
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Operations</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Server version</CardTitle>
            <CardDescription>Current backend release</CardDescription>
          </CardHeader>
          <CardContent>
            {infoQuery.isPending ? (
              <Skeleton className="h-5 w-20" />
            ) : infoQuery.isError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : (
              <p className="text-sm font-medium">{infoQuery.data?.version}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server uptime</CardTitle>
            <CardDescription>
              From /api/system and /api/system/health
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {infoQuery.isPending ? (
              <Skeleton className="h-5 w-28" />
            ) : infoQuery.isError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : (
              <p className="text-sm font-medium">
                {formatUptime(infoQuery.data?.uptime ?? 0)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Health:{' '}
              {healthQuery.isPending ? (
                'Checking...'
              ) : healthQuery.isError ? (
                'Unavailable'
              ) : (
                healthQuery.data?.status
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Database status</CardTitle>
            <CardDescription>Quick connectivity signal</CardDescription>
          </CardHeader>
          <CardContent>
            {healthQuery.isPending ? (
              <Skeleton className="h-5 w-16" />
            ) : healthQuery.isError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : (
              <Badge variant="success">{healthQuery.data?.db}</Badge>
            )}
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
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-24" />
              </div>
            ) : infoQuery.isError ? (
              <p className="text-sm text-destructive">
                Unable to load modules.
              </p>
            ) : modules.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {modules.map((moduleName) => (
                  <Badge key={moduleName} variant="secondary">
                    {moduleName}
                  </Badge>
                ))}
              </div>
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
              <div className="flex flex-col gap-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : auditQuery.isError ? (
              <p className="text-sm text-destructive">
                Unable to load audit log.
              </p>
            ) : recentEntries.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {recentEntries.map((entry, index) => (
                  <li
                    key={entry.id ?? `${entry.event}-${index}`}
                    className="rounded-md border px-3 py-2"
                  >
                    <p className="text-sm font-medium">{entry.event}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.actorEmail ?? 'Unknown actor'} &middot;{' '}
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

export const Route = createFileRoute('/_app/system/list')({
  component: SystemDashboardPage,
});
