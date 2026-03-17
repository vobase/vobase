import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { DefaultChatTransport, type TextUIPart, type UIMessage } from 'ai';
import { CopyIcon, MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { ThreadList } from '@/components/chat/thread-list';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Thread {
  id: string;
  title: string | null;
  agentId: string;
  channel: string;
  status: string;
  contactId: string | null;
  createdAt: string;
}

interface DbMessage {
  id: string;
  threadId: string;
  aiRole: string | null;
  content: string | null;
  sources: string | null;
  toolCalls: string | null;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  model: string | null;
  suggestions: string | null;
}

async function fetchThreads(): Promise<Thread[]> {
  const res = await fetch('/api/messaging/threads');
  if (!res.ok) throw new Error('Failed to fetch threads');
  return res.json();
}

async function fetchThread(
  id: string,
): Promise<Thread & { messages: DbMessage[] }> {
  const res = await fetch(`/api/messaging/threads/${id}`);
  if (!res.ok) throw new Error('Failed to fetch thread');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/messaging/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

function toUIMessages(dbMessages: DbMessage[]): UIMessage[] {
  return dbMessages.map((msg) => ({
    id: msg.id,
    role: (msg.aiRole ?? 'user') as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: msg.content ?? '' }],
    createdAt: new Date(msg.createdAt),
  }));
}

function getAgentSuggestions(
  agents: Agent[] | undefined,
  agentId?: string,
): string[] {
  const agent = agents?.find((a) => a.id === agentId);
  if (!agent?.suggestions)
    return [
      'Help me write a function that',
      'Search the knowledge base for',
      'Explain how',
      'Give me ideas for',
    ];
  try {
    const parsed = JSON.parse(agent.suggestions) as string[];
    return parsed.length > 0
      ? parsed
      : [
          'Help me write a function that',
          'Search the knowledge base for',
          'Explain how',
          'Give me ideas for',
        ];
  } catch {
    return [
      'Help me write a function that',
      'Search the knowledge base for',
      'Explain how',
      'Give me ideas for',
    ];
  }
}

/** Chat view for an active thread */
function ThreadChat({
  threadId,
  initialMessages,
  autoSendMessage,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  autoSendMessage?: string;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [autoSent, setAutoSent] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/messaging/threads/${threadId}/chat`,
      }),
    [threadId],
  );

  const { messages, sendMessage, status } = useChat({
    id: threadId,
    transport,
    messages: initialMessages,
    onError: (error) => {
      toast.error(
        error.message ||
          'Failed to send message. Check your API key and model configuration.',
      );
    },
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-threads'] });
      queryClient.invalidateQueries({
        queryKey: ['messaging-thread', threadId],
      });
    },
  });

  if (autoSendMessage && !autoSent && initialMessages.length === 0) {
    setAutoSent(true);
    sendMessage({ text: autoSendMessage });
  }

  function handleSubmit(msg: PromptInputMessage) {
    if (!msg.text.trim()) return;
    sendMessage({ text: msg.text });
    setInput('');
  }

  const isStreaming = status === 'streaming' || status === 'submitted';
  const lastMessage = messages[messages.length - 1];
  const lastAssistantText =
    lastMessage?.role === 'assistant'
      ? lastMessage.parts
          .filter((p): p is TextUIPart => p.type === 'text')
          .map((p) => p.text)
          .join('')
      : '';
  const showShimmer =
    isStreaming && (lastMessage?.role === 'user' || !lastAssistantText.trim());

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="max-w-2xl mx-auto p-4">
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                {msg.parts.map((part) => {
                  if (part.type === 'text') {
                    return (
                      <MessageResponse key={`${msg.id}-${part.type}`}>
                        {part.text}
                      </MessageResponse>
                    );
                  }
                  return null;
                })}
              </MessageContent>
              {msg.role === 'assistant' && !isStreaming && (
                <MessageActions>
                  <MessageAction
                    label="Copy"
                    onClick={() => {
                      const text = msg.parts
                        .filter((p): p is TextUIPart => p.type === 'text')
                        .map((p) => p.text)
                        .join('');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <CopyIcon className="size-3" />
                  </MessageAction>
                </MessageActions>
              )}
            </Message>
          ))}
          {showShimmer && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-sm" duration={1.5}>
                  Thinking...
                </Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <div className="max-w-2xl mx-auto">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Type a message…"
              className="pr-12"
            />
            <PromptInputSubmit
              disabled={!input.trim() || isStreaming}
              status={isStreaming ? 'streaming' : 'ready'}
              className="absolute bottom-1 right-1"
            />
          </PromptInput>
        </div>
      </div>
    </>
  );
}

function MessagingPage() {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [welcomeInput, setWelcomeInput] = useState('');

  const { data: allThreads = [] } = useQuery({
    queryKey: ['messaging-threads'],
    queryFn: fetchThreads,
  });
  const threads = allThreads.filter(
    (t) => channelFilter === 'all' || t.channel === channelFilter,
  );
  const { data: agents } = useQuery({
    queryKey: ['messaging-agents'],
    queryFn: fetchAgents,
  });
  const { data: activeThread } = useQuery({
    queryKey: ['messaging-thread', activeThreadId],
    queryFn: () => fetchThread(activeThreadId!),
    enabled: !!activeThreadId,
  });

  const activeAgentId = selectedAgentId ?? agents?.[0]?.id ?? null;
  const hasAgents = (agents?.length ?? 0) > 0;
  const suggestions = getAgentSuggestions(agents, activeAgentId ?? undefined);

  async function handleWelcomeSend(text: string) {
    if (!text.trim() || !activeAgentId) return;
    const res = await fetch('/api/messaging/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: activeAgentId }),
    });
    if (!res.ok) {
      toast.error('Failed to create thread');
      return;
    }
    const thread = (await res.json()) as Thread;
    queryClient.invalidateQueries({ queryKey: ['messaging-threads'] });
    setActiveThreadId(thread.id);
    setWelcomeInput(text);
  }

  const initialMessages = useMemo(() => {
    return toUIMessages(activeThread?.messages ?? []);
  }, [activeThread?.messages]);

  const renderWelcome = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-8 -mt-12">
        {/* Greeting */}
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

        {/* Agent selector */}
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

        {/* Suggestion chips — AI Elements Suggestion component */}
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

        {/* Input box */}
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
              <Link to="/messaging/agents">Create agent</Link>
            </Button>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          AI can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <div className="w-[280px] border-r flex flex-col">
        <div className="px-3 pt-3 pb-1">
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ThreadList
          threads={threads.map((t) => {
            const statusLabel =
              t.channel !== 'web'
                ? t.status === 'human'
                  ? '[Human] '
                  : t.status === 'paused'
                    ? '[Paused] '
                    : ''
                : '';
            const channelIcon =
              t.channel === 'whatsapp'
                ? 'WA: '
                : t.channel !== 'web'
                  ? `${t.channel}: `
                  : '';
            const fallbackTitle =
              t.channel !== 'web' ? `${t.channel} conversation` : 'Untitled';
            return {
              ...t,
              title: `${channelIcon}${statusLabel}${t.title ?? fallbackTitle}`,
            };
          })}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => {
            setActiveThreadId(id);
            setWelcomeInput('');
          }}
          onNewChat={() => {
            setActiveThreadId(null);
            setWelcomeInput('');
          }}
          hasAssistants={hasAgents}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!activeThreadId ? (
          renderWelcome()
        ) : !activeThread ? (
          <div className="flex-1 flex items-center justify-center">
            <Shimmer className="text-sm text-muted-foreground">
              Loading conversation...
            </Shimmer>
          </div>
        ) : (
          <ThreadChat
            key={activeThreadId}
            threadId={activeThreadId}
            initialMessages={initialMessages}
            autoSendMessage={welcomeInput || undefined}
          />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/threads')({
  component: MessagingPage,
});
