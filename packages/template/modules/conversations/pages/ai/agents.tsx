import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  BotIcon,
  MessageSquareIcon,
  SparklesIcon,
  WrenchIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { conversationsClient } from '@/lib/api-client';

interface Agent {
  id: string;
  name: string;
  model?: string;
  instructions: string;
  tools?: string[];
  channels?: string[];
  suggestions?: string[];
}

interface Thread {
  id: string;
  title: string | null;
  agentId: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await conversationsClient.agents.$get();
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json() as unknown as Promise<Agent[]>;
}

async function fetchConversations(): Promise<Thread[]> {
  const res = await conversationsClient.conversations.$get();
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json() as unknown as Promise<Thread[]>;
}

async function createConversation(agentId: string): Promise<Thread> {
  // biome-ignore lint/style/noRestrictedGlobals: No typed POST /sessions route — sessions are created via chat flow
  const res = await fetch('/api/conversations/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

function AgentCard({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const toolCount = agent.tools?.length ?? 0;

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <CardContent>
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="font-semibold text-sm leading-tight">{agent.name}</p>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {agent.model ?? 'Default'}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {agent.instructions}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          {toolCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              <WrenchIcon className="size-3" />
              {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
            </Badge>
          )}
          {(agent.channels ?? []).map((ch) => (
            <Badge key={ch} variant="outline" className="text-xs capitalize">
              {ch}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentDetailSheet({
  agent,
  threads,
  open,
  onOpenChange,
  onChat,
  isChatLoading,
}: {
  agent: Agent | null;
  threads: Thread[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChat: () => void;
  isChatLoading: boolean;
}) {
  if (!agent) return null;

  const agentThreads = threads
    .filter((t) => t.agentId === agent.id)
    .slice(0, 5);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <BotIcon className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm truncate">
                  {agent.name}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  {agent.model ?? 'Default model'}
                </SheetDescription>
              </div>
            </div>
          </div>
          <Button
            size="sm"
            className="mt-2 w-full gap-2"
            onClick={onChat}
            disabled={isChatLoading}
          >
            <MessageSquareIcon className="size-4" />
            Chat with {agent.name}
          </Button>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-hidden">
          <div className="divide-y">
            {/* Instructions */}
            <div className="px-6 py-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Instructions
              </h4>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {agent.instructions}
              </p>
            </div>

            {/* Tools */}
            {(agent.tools?.length ?? 0) > 0 && (
              <div className="px-6 py-4">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Tools
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {agent.tools?.map((tool) => (
                    <Badge key={tool} variant="secondary" className="text-xs">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Channels */}
            {(agent.channels?.length ?? 0) > 0 && (
              <div className="px-6 py-4">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Channels
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {agent.channels?.map((ch) => (
                    <Badge
                      key={ch}
                      variant="outline"
                      className="text-xs capitalize"
                    >
                      {ch}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {(agent.suggestions?.length ?? 0) > 0 && (
              <div className="px-6 py-4">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Suggestions
                </h4>
                <div className="space-y-1.5">
                  {agent.suggestions?.map((s) => (
                    <div
                      key={s}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <SparklesIcon className="size-3.5 mt-0.5 shrink-0 text-primary/60" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Activity */}
            <div className="px-6 py-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Recent Activity
              </h4>
              {agentThreads.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No recent conversations
                </p>
              ) : (
                <div className="space-y-2">
                  {agentThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-foreground">
                        {thread.title ?? 'Untitled'}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(thread.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function AgentsPage() {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const {
    data: agents,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['conversations-agents'],
    queryFn: fetchAgents,
  });

  const { data: threads = [] } = useQuery({
    queryKey: ['conversations-sessions'],
    queryFn: fetchConversations,
  });

  const chatMutation = useMutation({
    mutationFn: (agentId: string) => createConversation(agentId),
    onSuccess: (conversation) => {
      setSelectedAgent(null);
      navigate({
        to: '/conversations/sessions/$conversationId',
        params: { conversationId: conversation.id },
      });
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">AI Agents</h2>
        <p className="text-sm text-muted-foreground">
          AI agents available in your workspace
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive text-center py-12">
          Failed to load agents. Please try again.
        </p>
      )}

      {agents && agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No AI agents configured yet.
        </p>
      )}

      {agents && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={() => setSelectedAgent(agent)}
            />
          ))}
        </div>
      )}

      <AgentDetailSheet
        agent={selectedAgent}
        threads={threads}
        open={!!selectedAgent}
        onOpenChange={(open) => {
          if (!open) setSelectedAgent(null);
        }}
        onChat={() => {
          if (selectedAgent) chatMutation.mutate(selectedAgent.id);
        }}
        isChatLoading={chatMutation.isPending}
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/ai/agents')({
  component: AgentsPage,
});
