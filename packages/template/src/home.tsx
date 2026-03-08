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

async function fetchHealth(): Promise<string> {
  const response = await apiClient.health.$get();
  if (!response.ok) {
    throw new Error('Health endpoint failed');
  }

  const payload = (await response.json()) as { status?: string };
  return payload.status ?? 'unknown';
}

export type HomePageProps = Record<string, never>;

export function HomePage(_: Readonly<HomePageProps>) {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground">
        Welcome to your vobase project.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>
            Data fetched with TanStack Query + Hono RPC client.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {healthQuery.isPending ? (
            <Skeleton className="h-5 w-24" />
          ) : healthQuery.isError ? (
            <Badge variant="destructive">Unavailable</Badge>
          ) : (
            <Badge variant="outline">{healthQuery.data}</Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: HomePage,
});
