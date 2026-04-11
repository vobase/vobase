import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { ArrowUpIcon, Bot } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { TypingIndicator } from '@/components/chat/typing-indicator';
import { Button } from '@/components/ui/button';
import { usePublicChat } from '@/hooks/use-public-chat';
import {
  type RealtimePayload,
  subscribeToPayloads,
  useRealtimeInvalidation,
} from '@/hooks/use-realtime';
import { agentsClient } from '@/lib/api-client';
import { extractText } from '@/lib/normalize-message';

// ─── Types ──────────────────────────────────────────────────────────

interface ConversationMessage {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  createdAt: string;
}

// ─── Chat View ──────────────────────────────────────────────────────

function PublicChatView({
  channelRoutingId,
  conversationId,
}: {
  channelRoutingId: string;
  conversationId: string;
}) {
  useRealtimeInvalidation();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [sseTyping, setSseTyping] = useState(false);

  const { data: messages = [] } = useQuery({
    queryKey: ['public-chat-messages', conversationId],
    queryFn: async () => {
      const res = await agentsClient.chat[':channelRoutingId'].conversations[
        ':conversationId'
      ].$get({
        param: { channelRoutingId, conversationId },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { messages: ConversationMessage[] };
      return data.messages;
    },
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const { mutate: sendMessage, isPending } = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/agents/chat/${channelRoutingId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onMutate: (content) => {
      const previous = queryClient.getQueryData<ConversationMessage[]>([
        'public-chat-messages',
        conversationId,
      ]);
      queryClient.setQueryData<ConversationMessage[]>(
        ['public-chat-messages', conversationId],
        (old = []) => [
          ...old,
          {
            id: `optimistic-${Date.now()}`,
            role: 'user',
            parts: [{ type: 'text', text: content }],
            createdAt: new Date().toISOString(),
          },
        ],
      );
      return { previous };
    },
    onError: (_err, _content, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['public-chat-messages', conversationId],
          context.previous,
        );
      }
    },
  });

  const isAgentTyping = isPending || sseTyping;

  useEffect(() => {
    const unsubscribe = subscribeToPayloads((payload: RealtimePayload) => {
      if (
        payload.table === 'conversations-messages' &&
        payload.id === conversationId
      ) {
        queryClient.invalidateQueries({
          queryKey: ['public-chat-messages', conversationId],
        });
        setSseTyping(false);
      }
      if (
        payload.table === 'conversations' &&
        payload.id === conversationId &&
        payload.action === 'typing'
      ) {
        setSseTyping(true);
      }
    });
    return unsubscribe;
  }, [conversationId, queryClient]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isAgentTyping]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isPending) return;
    setInput('');
    sendMessage(trimmed);
  }, [input, isPending, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const trimmedInput = input.trim();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg) => {
            const textContent = extractText(msg.parts);
            if (!textContent) return null;

            const from = msg.role === 'user' ? 'user' : 'assistant';
            return (
              <Message key={msg.id} from={from}>
                <MessageContent>
                  {from === 'assistant' ? (
                    <MessageResponse>{textContent}</MessageResponse>
                  ) : (
                    <p>{textContent}</p>
                  )}
                </MessageContent>
              </Message>
            );
          })}
          {isAgentTyping && (
            <TypingIndicator conversationId={conversationId} isAiThinking />
          )}
        </div>
      </div>

      <div className="border-t bg-background px-4 pb-4 pt-3">
        <div className="mx-auto max-w-2xl">
          <div className="flex w-full gap-2 rounded-xl border bg-muted/30 p-2.5 transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="max-h-32 min-h-10 w-full flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
              rows={1}
              autoFocus
              aria-label="Message input"
            />
            <Button
              type="button"
              variant="default"
              size="icon"
              className="size-8 shrink-0 self-end rounded-full"
              disabled={!trimmedInput || isPending}
              onClick={handleSubmit}
              aria-label="Send message"
            >
              <ArrowUpIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

function PublicChatPage() {
  const { channelRoutingId } = useParams({ from: '/chat/$channelRoutingId' });
  const { conversationId, loading, error, errorRetryable, retry } =
    usePublicChat(channelRoutingId);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Shimmer className="text-sm text-muted-foreground">
          Connecting...
        </Shimmer>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <Bot className="mx-auto size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{error}</p>
          {errorRetryable && (
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!conversationId) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Bot className="size-5 text-primary" />
        <span className="text-sm font-medium">Chat</span>
      </div>

      <PublicChatView
        channelRoutingId={channelRoutingId}
        conversationId={conversationId}
      />
    </div>
  );
}

export const Route = createFileRoute('/chat/$channelRoutingId')({
  component: PublicChatPage,
});
