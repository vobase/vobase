import { useChat } from '@ai-sdk/react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Bot, MessageSquareIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { ConversationEmptyState } from '@/components/ai-elements/conversation';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ChatMessageList } from '@/components/chat/chat-message-list';
import { Button } from '@/components/ui/button';
import { useFeedback } from '@/hooks/use-feedback';
import { usePublicChat } from '@/hooks/use-public-chat';
import {
  type RealtimePayload,
  subscribeToPayloads,
  useRealtimeInvalidation,
} from '@/hooks/use-realtime';
import {
  useTypingListener,
  useTypingSender,
} from '@/hooks/use-typing-indicator';
import { authClient } from '@/lib/auth-client';
import { normalizeUIMessage } from '@/lib/normalize-message';

// ─── Chat View ──────────────────────────────────────────────────────────

const RESET_COMMANDS = new Set(['/reset', '/restart']);

function PublicChatView({
  channelRoutingId,
  conversationId,
  initialMessages,
  onReset,
}: {
  channelRoutingId: string;
  conversationId: string;
  initialMessages: UIMessage[];
  onReset: () => Promise<void>;
}) {
  // SSE connection for realtime events — mounted here (after anonymous sign-in)
  useRealtimeInvalidation();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/ai/chat/${channelRoutingId}/stream`,
        credentials: 'include',
      }),
    [channelRoutingId],
  );

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: conversationId,
    transport,
    messages: initialMessages,
    onError: (error) => {
      console.error('[public-chat] Error:', error.message);
    },
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Use a ref for status so the SSE listener doesn't re-subscribe on every status change
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const unsubscribe = subscribeToPayloads((payload: RealtimePayload) => {
      if (
        payload.table === 'conversations-messages' &&
        payload.id === conversationId &&
        statusRef.current === 'ready'
      ) {
        fetch(
          `/api/ai/chat/${channelRoutingId}/conversations/${conversationId}`,
          { credentials: 'include' },
        )
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!data?.messages) return;
            const uiMessages: UIMessage[] = data.messages.map(
              (m: {
                id: string;
                role: string;
                parts: UIMessage['parts'];
                createdAt: string;
              }) => ({
                id: m.id,
                role: m.role as 'user' | 'assistant',
                parts: m.parts,
                createdAt: new Date(m.createdAt),
              }),
            );
            setMessages(uiMessages);
          })
          .catch((err) =>
            console.error('[public-chat] message reload error:', err),
          );
      }
    });
    return unsubscribe;
  }, [conversationId, channelRoutingId, setMessages]);

  const normalized = useMemo(
    () => messages.map(normalizeUIMessage),
    [messages],
  );

  useTypingListener(conversationId);
  const { signalTyping } = useTypingSender(conversationId);
  const { data: session } = authClient.useSession();
  const { feedbackMap, handleReact } = useFeedback(conversationId);

  return (
    <>
      {messages.length === 0 && !isStreaming ? (
        <div className="flex flex-1 items-center justify-center">
          <ConversationEmptyState
            title="How can I help you?"
            description="Send a message to start the conversation."
            icon={
              <MessageSquareIcon className="size-8 text-muted-foreground/40" />
            }
          />
        </div>
      ) : (
        <ChatMessageList
          messages={normalized}
          viewMode="public"
          conversationId={conversationId}
          chatStatus={status}
          isStreaming={isStreaming}
          feedbackMap={feedbackMap}
          currentUserId={session?.user?.id}
          onReact={handleReact}
          excludeUserId={session?.user?.id}
          onAction={(actionId) => {
            const text = actionId.startsWith('chat:')
              ? (JSON.parse(actionId.slice(5)) as string)
              : actionId;
            sendMessage({ text });
          }}
        />
      )}

      <div className="border-t bg-background px-4 pb-4 pt-3">
        <div className="mx-auto max-w-2xl">
          <PromptInput
            onSubmit={({ text }) => {
              if (!text.trim() || isStreaming) return;
              if (RESET_COMMANDS.has(text.trim().toLowerCase())) {
                onReset();
                return;
              }
              sendMessage({ text });
            }}
            className="rounded-xl border bg-muted/30"
          >
            <PromptInputTextarea
              placeholder="Type a message..."
              autoFocus
              onChange={signalTyping}
            />
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit status={status} onStop={stop} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────

function PublicChatPage() {
  const { channelRoutingId } = useParams({ from: '/chat/$channelRoutingId' });
  const {
    conversationId,
    initialMessages,
    loading,
    error,
    errorRetryable,
    retry,
    reset,
  } = usePublicChat(channelRoutingId);

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
        initialMessages={initialMessages}
        onReset={reset}
      />
    </div>
  );
}

export const Route = createFileRoute('/chat/$channelRoutingId')({
  component: PublicChatPage,
});
