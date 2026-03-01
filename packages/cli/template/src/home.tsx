import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { apiClient } from './lib/api-client';

async function fetchHealth(): Promise<string> {
  const response = await apiClient.health.$get();
  if (!response.ok) {
    throw new Error('Health endpoint failed');
  }

  const payload = (await response.json()) as { status?: string };
  return payload.status ?? 'unknown';
}

export interface HomePageProps {}

export function HomePage(_: Readonly<HomePageProps>) {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground mt-2">Welcome to your vobase project.</p>

      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Data fetched with TanStack Query + Hono RPC client.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Health:{' '}
            {healthQuery.isPending
              ? 'Loading...'
              : healthQuery.isError
                ? 'Unavailable'
                : healthQuery.data}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: HomePage,
});
