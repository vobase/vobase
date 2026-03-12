import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
      <div>
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Overview
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Dashboard</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthQuery.isPending ? (
              <Skeleton className="h-7 w-16" />
            ) : healthQuery.isError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
                <span className="text-xl font-bold">
                  {healthQuery.data.status}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthQuery.isPending ? (
              <Skeleton className="h-7 w-24" />
            ) : healthQuery.isError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
                <span className="text-xl font-bold">
                  {healthQuery.data.db}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Modules
            </CardTitle>
          </CardHeader>
          <CardContent>
            {infoQuery.isPending ? (
              <Skeleton className="h-7 w-8" />
            ) : infoQuery.isError ? (
              <Badge variant="destructive">Unavailable</Badge>
            ) : (
              <span className="text-xl font-bold">
                {infoQuery.data.modules.length}
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs font-medium text-muted-foreground uppercase">
                    <th className="pb-3 pr-4">Event</th>
                    <th className="pb-3 pr-4">Actor</th>
                    <th className="pb-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.map((entry, index) => (
                    <tr
                      key={entry.id ?? `${entry.event}-${index}`}
                      className="border-t"
                    >
                      <td className="py-3 pr-4 font-medium">
                        {entry.event}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {entry.actorEmail ?? 'System'}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {formatTimestamp(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recent activity.
            </p>
          )}

          {recentEntries.length > 0 ? (
            <>
              <Separator className="my-4" />
              <Link
                to="/system/logs"
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                View all audit logs &rarr;
              </Link>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});
