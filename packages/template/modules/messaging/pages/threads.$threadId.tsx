import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { DefaultChatTransport, type TextUIPart, type UIMessage } from 'ai';
import {
  CheckCircle2,
  CopyIcon,
  Loader2,
  MessageSquare,
  Wrench,
} from 'lucide-react';
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
  model?: string;
  suggestions?: string[];
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

function isToolPart(part: unknown): part is {
  toolName: string;
  toolCallId: string;
  state: string;
  output?: unknown;
} {
  return (
    typeof part === 'object' &&
    part !== null &&
    'toolName' in part &&
    'toolCallId' in part
  );
}

function ToolCallPart({
  part,
}: {
  part: {
    toolName: string;
    toolCallId: string;
    state: string;
    output?: unknown;
  };
}) {
  const isRunning =
    part.state === 'input-streaming' || part.state === 'input-available';
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      {isRunning ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <CheckCircle2 className="size-3" />
      )}
      <Wrench className="size-3" />
      <span className="font-medium">{part.toolName}</span>
      {part.state === 'output-available' && part.output != null && (
        <span className="truncate max-w-[300px]">
          {typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output).slice(0, 120)}
        </span>
      )}
    </div>
  );
}

/** Chat view — shows placeholder when no messages */
function ThreadChat({
  threadId,
  initialMessages,
  suggestions,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  suggestions: string[];
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');

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

  function handleSubmit(msg: PromptInputMessage) {
    if (!msg.text.trim()) return;
    sendMessage({ text: msg.text });
    setInput('');
  }

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isEmpty = messages.length === 0;
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
      {isEmpty && !isStreaming ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-xl space-y-6 -mt-12">
            <div className="space-y-2 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">
                Start a conversation
              </h2>
              <p className="text-sm text-muted-foreground">
                Send a message to get started.
              </p>
            </div>

            <Suggestions className="justify-center">
              {suggestions.map((s) => (
                <Suggestion
                  key={s}
                  suggestion={s}
                  onClick={(text) => {
                    sendMessage({ text });
                  }}
                />
              ))}
            </Suggestions>
          </div>
        </div>
      ) : (
        <Conversation className="flex-1">
          <ConversationContent className="max-w-2xl mx-auto p-4">
            {messages.map((msg) => (
              <Message key={msg.id} from={msg.role}>
                <MessageContent>
                  {msg.parts.map((part, partIdx) => {
                    if (part.type === 'text') {
                      return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: multi-step agent produces multiple text parts with no unique id
                        <MessageResponse key={`${msg.id}-${partIdx}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (isToolPart(part)) {
                      return (
                        <ToolCallPart
                          key={`${msg.id}-${part.toolCallId}`}
                          part={part}
                        />
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
      )}

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

function ThreadDetailPage() {
  const { threadId } = useParams({ from: '/_app/messaging/threads/$threadId' });

  const { data: agents } = useQuery({
    queryKey: ['messaging-agents'],
    queryFn: fetchAgents,
  });
  const { data: activeThread } = useQuery({
    queryKey: ['messaging-thread', threadId],
    queryFn: () => fetchThread(threadId),
  });

  const suggestions = getAgentSuggestions(
    agents,
    activeThread?.agentId ?? undefined,
  );

  const initialMessages = useMemo(() => {
    return toUIMessages(activeThread?.messages ?? []);
  }, [activeThread?.messages]);

  if (!activeThread) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Shimmer className="text-sm text-muted-foreground">
          Loading conversation...
        </Shimmer>
      </div>
    );
  }

  return (
    <ThreadChat
      key={threadId}
      threadId={threadId}
      initialMessages={initialMessages}
      suggestions={suggestions}
    />
  );
}

export const Route = createFileRoute('/_app/messaging/threads/$threadId')({
  component: ThreadDetailPage,
});
