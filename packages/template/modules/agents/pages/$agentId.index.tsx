import { MODEL_OPTIONS } from '@modules/agents/mastra/lib/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { agentsClient } from '@/lib/api-client';
import { AgentAvatar } from './-agent-avatar';
import { FileRow } from './-file-row';

interface AgentDef {
  id: string;
  name: string;
  model: string;
  channels: string[] | null;
  mode: string | null;
  suggestions: string[] | null;
}

interface WorkspaceFile {
  id: string;
  path: string;
  writtenBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data: agent, isLoading: agentLoading } = useQuery<AgentDef>({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const res = await agentsClient.agents[':id'].$get({
        param: { id: agentId },
      });
      if (!res.ok) throw new Error('Failed to fetch agent');
      return res.json() as Promise<AgentDef>;
    },
    enabled: !!agentId,
  });

  const { data: files = [], isLoading: filesLoading } = useQuery<
    WorkspaceFile[]
  >({
    queryKey: ['agent-files', agentId],
    queryFn: async () => {
      const res = await agentsClient.agents[':agentId'].files.$get({
        param: { agentId },
      });
      if (!res.ok) throw new Error('Failed to fetch files');
      return res.json() as Promise<WorkspaceFile[]>;
    },
    enabled: !!agentId,
  });

  const [name, setName] = useState('');
  const [model, setModel] = useState('');

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setModel(agent.model);
    }
  }, [agent]);

  const dirty = !!agent && (name !== agent.name || model !== agent.model);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await agentsClient.agents[':id'].$patch(
        { param: { id: agentId } },
        {
          init: {
            body: JSON.stringify({ name, model }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    },
  });

  if (agentLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <Empty className="m-6 border">
        <EmptyHeader>
          <EmptyTitle>Agent not found</EmptyTitle>
          <EmptyDescription>
            <Link to="/agents" className="hover:text-primary">
              Back to agents
            </Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to="/agents"
          className="hover:text-foreground flex items-center gap-1"
        >
          <ChevronLeft className="size-3.5" />
          Agents
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground font-medium">{agent.name}</span>
      </nav>

      <div className="flex items-center gap-3">
        <AgentAvatar />
        <div>
          <h1 className="text-lg font-semibold">{agent.name}</h1>
          <p className="text-xs text-muted-foreground">
            {agent.model.includes('/')
              ? agent.model.split('/')[1]
              : agent.model}
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-medium">Settings</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-model">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="agent-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {agent.channels && agent.channels.length > 0 && (
          <div className="space-y-1.5">
            <Label>Channels</Label>
            <div className="flex flex-wrap gap-1.5">
              {agent.channels.map((ch) => (
                <Badge key={ch} variant="secondary" className="capitalize">
                  {ch}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {agent.mode && (
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Badge variant="outline" className="capitalize">
              {agent.mode.replace(/-/g, ' ')}
            </Badge>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div>
            {saveMutation.isError && (
              <p className="text-xs text-destructive">Failed to save changes</p>
            )}
            {saveMutation.isSuccess && !dirty && (
              <p className="text-xs text-muted-foreground">Changes saved</p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            <Save className="size-3.5 mr-1.5" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Workspace Files
        </h2>

        {filesLoading ? (
          <div className="space-y-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No files found.</p>
        ) : (
          <div className="space-y-0.5">
            {files.map((file) => (
              <FileRow
                key={file.id}
                name={file.path}
                icon="blue"
                updatedAt={file.updatedAt}
                to="/agents/$agentId/editor"
                linkParams={{ agentId }}
                linkSearch={{ path: file.path }}
                menuItems={
                  <DropdownMenuItem asChild>
                    <Link
                      to="/agents/$agentId/editor"
                      params={{ agentId }}
                      search={{ path: file.path }}
                    >
                      Edit
                    </Link>
                  </DropdownMenuItem>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/agents/$agentId/')({
  component: AgentDetailPage,
});
