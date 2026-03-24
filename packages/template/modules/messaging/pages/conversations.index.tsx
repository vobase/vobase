import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ConversationData {
  id: string;
}

interface Agent {
  id: string;
  name: string;
  suggestions?: string[];
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/messaging/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

const DEFAULT_SUGGESTIONS = [
  'Help me write a function that',
  'Search the knowledge base for',
  'Explain how',
  'Give me ideas for',
];

function getAgentSuggestions(
  agents: Agent[] | undefined,
  agentId?: string,
): string[] {
  const agent = agents?.find((a) => a.id === agentId);
  if (!agent?.suggestions || agent.suggestions.length === 0) {
    return DEFAULT_SUGGESTIONS;
  }
  return agent.suggestions;
}

function ConversationsIndex() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [welcomeInput, setWelcomeInput] = useState('');

  const { data: agents } = useQuery({
    queryKey: ['messaging-agents'],
    queryFn: fetchAgents,
  });

  const activeAgentId = selectedAgentId ?? agents?.[0]?.id ?? null;
  const hasAgents = (agents?.length ?? 0) > 0;
  const suggestions = getAgentSuggestions(agents, activeAgentId ?? undefined);

  async function handleWelcomeSend(text: string) {
    if (!text.trim() || !activeAgentId) return;
    const res = await fetch('/api/messaging/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: activeAgentId }),
    });
    if (!res.ok) {
      toast.error('Failed to create conversation');
      return;
    }
    const conversation = (await res.json()) as ConversationData;
    queryClient.invalidateQueries({
      queryKey: ['messaging-conversations'],
    });
    navigate({
      to: '/messaging/conversations/$conversationId',
      params: { conversationId: conversation.id },
    });
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-8 -mt-12">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {hasAgents
              ? 'What can I help you with?'
              : 'Create an agent to get started'}
          </h1>
          {!hasAgents && (
            <p className="text-sm text-muted-foreground">
              You need at least one agent before you can start chatting.
            </p>
          )}
        </div>

        {hasAgents && (agents?.length ?? 0) > 1 && (
          <div className="flex justify-center">
            <Select
              value={activeAgentId ?? ''}
              onValueChange={setSelectedAgentId}
            >
              <SelectTrigger className="w-auto gap-2">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {hasAgents && (
          <Suggestions className="justify-center">
            {suggestions.map((s) => (
              <Suggestion
                key={s}
                suggestion={s}
                onClick={(text) => handleWelcomeSend(text)}
              />
            ))}
          </Suggestions>
        )}

        {hasAgents ? (
          <PromptInput
            onSubmit={(msg) => handleWelcomeSend(msg.text)}
            className="w-full"
          >
            <PromptInputTextarea
              value={welcomeInput}
              onChange={(e) => setWelcomeInput(e.currentTarget.value)}
              placeholder="Ask anything..."
              className="pr-12"
            />
            <PromptInputSubmit
              disabled={!welcomeInput.trim()}
              className="absolute bottom-1 right-1"
            />
          </PromptInput>
        ) : (
          <div className="flex justify-center">
            <Button asChild>
              <Link to="/ai/agents">Create agent</Link>
            </Button>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          AI can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/conversations/')({
  component: ConversationsIndex,
});
