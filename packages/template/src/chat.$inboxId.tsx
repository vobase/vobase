import { useChat } from '@ai-sdk/react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { DefaultChatTransport, type TextUIPart, type UIMessage } from 'ai';
import { Bot, Loader2, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';

// ─── Types ───────────────────────────────────────────────────────────

interface StartResponse {
  conversationId: string;
  agentId: string | null;
}

interface ConversationMessages {
  id: string;
  title: string | null;
  agentId: string | null;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getVisitorToken(inboxId: string): string {
  const key = `vobase-visitor-${inboxId}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    localStorage.setItem(key, token);
  }
  return token;
}

function getStoredConversationId(inboxId: string): string | null {
  return localStorage.getItem(`vobase-conv-${inboxId}`);
}

function storeConversationId(inboxId: string, conversationId: string) {
  localStorage.setItem(`vobase-conv-${inboxId}`, conversationId);
}

// ─── Chat Component ──────────────────────────────────────────────────

function PublicChatView({
  inboxId,
  conversationId,
  visitorToken,
  initialMessages,
}: {
  inboxId: string;
  conversationId: string;
  visitorToken: string;
  initialMessages: UIMessage[];
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/messaging/chat/${inboxId}/stream?visitorToken=${encodeURIComponent(visitorToken)}`,
      }),
    [inboxId, visitorToken],
  );

  const { messages, sendMessage, status } = useChat({
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
  const showShimmer =
    isStreaming && (lastMessage?.role === 'user' || !lastAssistantText.trim());

  function handleSubmit() {
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="max-w-2xl mx-auto p-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                Send a message to start the conversation.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                {msg.parts.map((part, partIdx) => {
                  if (part.type === 'text') {
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: text parts have no unique id
                      <MessageResponse key={`${msg.id}-${partIdx}`}>
                        {part.text}
                      </MessageResponse>
                    );
                  }
                  return null;
                })}
              </MessageContent>
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
        <div className="max-w-2xl mx-auto flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="icon"
            disabled={!input.trim() || isStreaming}
            onClick={handleSubmit}
            className="shrink-0 self-end"
          >
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

function PublicChatPage() {
  const { inboxId } = useParams({ from: '/chat/$inboxId' });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(true);
  const [loading, setLoading] = useState(true);
  const initRef = useRef(false);

  const initChat = useCallback(async () => {
    if (initRef.current) return;
    initRef.current = true;

    try {
      const visitorToken = getVisitorToken(inboxId);
      const storedConvId = getStoredConversationId(inboxId);

      // Try to resume existing conversation
      if (storedConvId) {
        try {
          const res = await fetch(
            `/api/messaging/chat/${inboxId}/conversations/${storedConvId}?visitorToken=${encodeURIComponent(visitorToken)}`,
          );
          if (res.ok) {
            const data: ConversationMessages = await res.json();
            const uiMessages: UIMessage[] = data.messages.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              parts: [{ type: 'text' as const, text: m.content }],
              createdAt: new Date(m.createdAt),
            }));
            setConversationId(data.id);
            setInitialMessages(uiMessages);
            setLoading(false);
            return;
          }
        } catch {
          // Failed to resume — start fresh
        }
      }

      // Start new conversation
      const startRes = await fetch(`/api/messaging/chat/${inboxId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorToken }),
      });

      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        const msg =
          (errData as { message?: string }).message ?? 'Chat unavailable';
        if (startRes.status === 404) {
          setError('This chat is unavailable.');
          setErrorRetryable(false);
        } else {
          setError(msg);
          setErrorRetryable(true);
        }
        setLoading(false);
        return;
      }

      const startData: StartResponse = await startRes.json();
      storeConversationId(inboxId, startData.conversationId);
      setConversationId(startData.conversationId);
      setLoading(false);
    } catch {
      setError('Failed to connect to chat');
      setLoading(false);
    }
  }, [inboxId]);

  useEffect(() => {
    initChat();
  }, [initChat]);

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
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">{error}</p>
          {errorRetryable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                initRef.current = false;
                setError(null);
                setErrorRetryable(true);
                setLoading(true);
                initChat();
              }}
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!conversationId) return null;

  const visitorToken = getVisitorToken(inboxId);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Minimal header */}
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <span className="text-sm font-medium">Chat</span>
      </div>

      <PublicChatView
        inboxId={inboxId}
        conversationId={conversationId}
        visitorToken={visitorToken}
        initialMessages={initialMessages}
      />
    </div>
  );
}

export const Route = createFileRoute('/chat/$inboxId')({
  component: PublicChatPage,
});
