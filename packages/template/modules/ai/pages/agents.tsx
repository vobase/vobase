import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Agent {
  id: string;
  name: string;
  model?: string;
  instructions: string;
  tools?: string[];
  channels?: string[];
  suggestions?: string[];
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/messaging/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

function AgentsPage() {
  const { data: agents, isLoading } = useQuery({
    queryKey: ['messaging-agents'],
    queryFn: fetchAgents,
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Agents</h2>
        <p className="text-sm text-muted-foreground">
          AI agents defined in code — edit{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            modules/ai/agents/
          </code>{' '}
          to configure
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {agents && agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No agents defined. Add agent files to{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            modules/ai/agents/
          </code>
          .
        </p>
      )}

      {agents && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Card key={agent.id} className="flex flex-col">
              <CardContent className="flex-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-semibold text-sm leading-tight">
                    {agent.name}
                  </p>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {agent.model ?? 'Default'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                  {agent.instructions}
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(agent.tools ?? []).map((tool) => (
                    <Badge key={tool} variant="outline" className="text-xs">
                      {tool}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(agent.channels ?? []).map((ch) => (
                    <Badge
                      key={ch}
                      variant="outline"
                      className="text-xs capitalize"
                    >
                      {ch}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/ai/agents')({
  component: AgentsPage,
});
