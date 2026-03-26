import { useChat } from '@ai-sdk/react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import type { TextUIPart } from 'ai';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Bot, MessageSquareIcon } from 'lucide-react';
import { useMemo } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { MessagePartsRenderer } from '@/components/chat/message-parts-renderer';
import { ThinkingMessage } from '@/components/chat/thinking-message';
import { Button } from '@/components/ui/button';
import { usePublicChat } from '@/hooks/use-public-chat';

// ─── Chat View ──────────────────────────────────────────────────────────

function PublicChatView({
  endpointId,
  conversationId,
  visitorToken,
  initialMessages,
}: {
  endpointId: string;
  conversationId: string;
  visitorToken: string;
  initialMessages: UIMessage[];
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/conversations/chat/${endpointId}/stream?visitorToken=${encodeURIComponent(visitorToken)}`,
      }),
    [endpointId, visitorToken],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: conversationId,
    transport,
    messages: initialMessages,
    onError: (error) => {
      console.error('[public-chat] Error:', error.message);
    },
  });

  const isStreaming = status === 'streaming' || status === 'submitted';
  const lastMessage = messages[messages.length - 1];
  const lastAssistantText =
    lastMessage?.role === 'assistant'
      ? lastMessage.parts
          .filter((p): p is TextUIPart => p.type === 'text')
          .map((p) => p.text)
          .join('')
      : '';
  const showThinking =
    isStreaming && (lastMessage?.role === 'user' || !lastAssistantText.trim());

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-2xl">
          {messages.length === 0 && !isStreaming && (
            <ConversationEmptyState
              title="How can I help you?"
              description="Send a message to start the conversation."
              icon={
                <MessageSquareIcon className="size-8 text-muted-foreground/40" />
              }
            />
          )}
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                <MessagePartsRenderer
                  parts={
                    msg.parts as Array<{
                      type: string;
                      text?: string;
                      [key: string]: unknown;
                    }>
                  }
                  messageId={msg.id}
                  onAction={(actionId) => {
                    // Strip chat: prefix (used by WhatsApp convention) and
                    // JSON.parse to recover the original clean action ID
                    const text = actionId.startsWith('chat:')
                      ? (JSON.parse(actionId.slice(5)) as string)
                      : actionId;
                    sendMessage({ text });
                  }}
                />
              </MessageContent>
            </Message>
          ))}
          {showThinking && <ThinkingMessage />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t bg-background px-4 pb-4 pt-3">
        <div className="mx-auto max-w-2xl">
          <PromptInput
            onSubmit={({ text }) => {
              if (!text.trim() || isStreaming) return;
              sendMessage({ text });
            }}
            className="rounded-xl border bg-muted/30"
          >
            <PromptInputTextarea placeholder="Type a message..." autoFocus />
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
  const { endpointId } = useParams({ from: '/chat/$endpointId' });
  const {
    conversationId,
    visitorToken,
    initialMessages,
    loading,
    error,
    errorRetryable,
    retry,
  } = usePublicChat(endpointId);

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
        endpointId={endpointId}
        conversationId={conversationId}
        visitorToken={visitorToken}
        initialMessages={initialMessages}
      />
    </div>
  );
}

export const Route = createFileRoute('/chat/$endpointId')({
  component: PublicChatPage,
});
