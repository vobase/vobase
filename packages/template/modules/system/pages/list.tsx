import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Activity, Box, Database, Heart } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Stat,
  StatDescription,
  StatIndicator,
  StatLabel,
  StatValue,
} from '@/components/ui/stat';
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
        <Stat>
          <StatIndicator variant="icon">
            <Activity />
          </StatIndicator>
          <StatLabel>Version</StatLabel>
          <StatValue>
            {infoQuery.isPending
              ? '—'
              : infoQuery.isError
                ? 'Unavailable'
                : (infoQuery.data?.version ?? '—')}
          </StatValue>
          <StatDescription>Current backend release</StatDescription>
        </Stat>
        <Stat>
          <StatIndicator variant="icon">
            <Heart />
          </StatIndicator>
          <StatLabel>Health</StatLabel>
          <StatValue>
            {healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data?.status ?? '—')}
          </StatValue>
          <StatDescription>API health status</StatDescription>
        </Stat>
        <Stat>
          <StatIndicator variant="icon">
            <Database />
          </StatIndicator>
          <StatLabel>Database</StatLabel>
          <StatValue>
            {healthQuery.isPending
              ? '—'
              : healthQuery.isError
                ? 'Unavailable'
                : (healthQuery.data?.db ?? '—')}
          </StatValue>
          <StatDescription>SQLite connectivity</StatDescription>
        </Stat>
        <Stat>
          <StatIndicator variant="icon">
            <Box />
          </StatIndicator>
          <StatLabel>Modules</StatLabel>
          <StatValue>
            {infoQuery.isPending
              ? '—'
              : infoQuery.isError
                ? 'Unavailable'
                : modules.length}
          </StatValue>
          <StatDescription>Registered at runtime</StatDescription>
        </Stat>
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
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Box />
                </EmptyMedia>
                <EmptyTitle>No modules</EmptyTitle>
                <EmptyDescription>
                  No modules reported by the API.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/_app/system/list')({
  component: SystemDashboardPage,
});
