import { useChat } from '@ai-sdk/react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Bot } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { Shimmer } from '@/components/ai-elements/shimmer';
import { ThreadMessages } from '@/components/assistant-ui/thread';
import { VobaseComposer } from '@/components/chat/vobase-composer';
import { VobaseThreadProvider } from '@/components/chat/vobase-thread-context';
import { VobaseToolUIs } from '@/components/chat/vobase-tool-uis';
import { Button } from '@/components/ui/button';
import { useFeedback } from '@/hooks/use-feedback';
import { preparePublicMessages, usePublicChat } from '@/hooks/use-public-chat';
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

function PublicChatView({
  channelRoutingId,
  conversationId,
  initialMessages,
}: {
  channelRoutingId: string;
  conversationId: string;
  initialMessages: UIMessage[];
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

  const chatHelpers = useChat({
    id: conversationId,
    transport,
    messages: initialMessages,
    onError: (error) => {
      console.error('[public-chat] Error:', error.message);
    },
  });

  const { messages, setMessages, status } = chatHelpers;

  // Wrap useChat with assistant-ui runtime (preserves usePublicChat lifecycle)
  const runtime = useAISDKRuntime(chatHelpers);

  // Normalized messages for VobaseThreadProvider (feedback, metadata access)
  const normalizedMessages = useMemo(
    () => messages.map(normalizeUIMessage),
    [messages],
  );

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
            const uiMessages = preparePublicMessages(data.messages);
            setMessages(uiMessages);
          })
          .catch((err) =>
            console.error('[public-chat] message reload error:', err),
          );
      }
    });
    return unsubscribe;
  }, [conversationId, channelRoutingId, setMessages]);

  useTypingListener(conversationId);
  const { signalTyping } = useTypingSender(conversationId);
  const { data: session } = authClient.useSession();
  const { feedbackMap, handleReact, handleDeleteFeedback } =
    useFeedback(conversationId);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <VobaseThreadProvider
        viewMode="public"
        messages={normalizedMessages}
        feedbackMap={feedbackMap}
        currentUserId={session?.user?.id}
        onReact={handleReact}
        onDeleteFeedback={handleDeleteFeedback}
        conversationId={conversationId}
        isAiThinking={status === 'submitted' || status === 'streaming'}
      >
        <VobaseToolUIs />
        <div className="flex flex-1 flex-col overflow-hidden">
          <ThreadMessages />
        </div>
        <VobaseComposer onInputChange={signalTyping} />
      </VobaseThreadProvider>
    </AssistantRuntimeProvider>
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
      />
    </div>
  );
}

export const Route = createFileRoute('/chat/$channelRoutingId')({
  component: PublicChatPage,
});
