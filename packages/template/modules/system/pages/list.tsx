import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Activity, Box, Database, Heart } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { systemClient } from '@/lib/api-client';

async function fetchSystemInfo() {
  const response = await systemClient.index.$get();
  if (!response.ok) {
    throw new Error('Failed to fetch system info');
  }

  return response.json();
}

async function fetchSystemHealth() {
  const response = await systemClient.health.$get();
  if (!response.ok) {
    throw new Error('Failed to fetch system health');
  }

  return response.json();
}

type SystemDashboardPageProps = Record<string, never>;

function SystemDashboardPage(_: Readonly<SystemDashboardPageProps>) {
  const infoQuery = useQuery({
    queryKey: ['system-info'],
    queryFn: fetchSystemInfo,
  });

  const healthQuery = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
  });

  const modules = infoQuery.data?.modules ?? [];

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <PageHeader
        title="Operations"
        description="System health and registered modules"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Version"
          value={
            infoQuery.isPending
              ? '—'
              : infoQuery.isError
                ? 'Unavailable'
                : (infoQuery.data?.version ?? '—')
          }
          description="Current backend release"
        />
        <StatCard
          icon={Heart}
          label="Health"
          value={
            healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data?.status ?? '—')
          }
          description="API health status"
        />
        <StatCard
          icon={Database}
          label="Database"
          value={
            healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data?.db ?? '—')
          }
          description="SQLite connectivity"
        />
        <StatCard
          icon={Box}
          label="Modules"
          value={
            infoQuery.isPending
              ? '—'
              : infoQuery.isError
                ? 'Unavailable'
                : modules.length
          }
          description="Registered at runtime"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Registered Modules
          </CardTitle>
        </CardHeader>
        <CardContent>
          {infoQuery.isPending ? (
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ) : infoQuery.isError ? (
            <p className="text-sm text-destructive">Unable to load modules.</p>
          ) : modules.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {modules.map((moduleName) => (
                <Badge key={moduleName} variant="secondary">
                  {moduleName}
                </Badge>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Box}
              title="No modules"
              description="No modules reported by the API."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/_app/system/list')({
  component: SystemDashboardPage,
});
