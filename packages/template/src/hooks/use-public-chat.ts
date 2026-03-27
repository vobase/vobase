import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────

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
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
    createdAt: string;
  }>;
}

export interface UsePublicChatResult {
  conversationId: string | null;
  visitorToken: string;
  initialMessages: UIMessage[];
  loading: boolean;
  error: string | null;
  errorRetryable: boolean;
  retry: () => void;
  reset: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function getVisitorToken(channelRoutingId: string): string {
  const key = `vobase-visitor-${channelRoutingId}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    localStorage.setItem(key, token);
  }
  return token;
}

export function getStoredConversationId(
  channelRoutingId: string,
): string | null {
  return localStorage.getItem(`vobase-conv-${channelRoutingId}`);
}

export function storeConversationId(
  channelRoutingId: string,
  conversationId: string,
) {
  localStorage.setItem(`vobase-conv-${channelRoutingId}`, conversationId);
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function usePublicChat(channelRoutingId: string): UsePublicChatResult {
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
      const visitorToken = getVisitorToken(channelRoutingId);
      const storedConvId = getStoredConversationId(channelRoutingId);

      // Try to resume existing conversation
      if (storedConvId) {
        try {
          // biome-ignore lint/style/noRestrictedGlobals: Public chat routes lack Hono validators for typed RPC
          const res = await fetch(
            `/api/conversations/chat/${channelRoutingId}/conversations/${storedConvId}?visitorToken=${encodeURIComponent(visitorToken)}`,
          );
          if (res.ok) {
            const data: ConversationMessages = await res.json();
            const uiMessages: UIMessage[] = data.messages.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              parts: m.parts as UIMessage['parts'],
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
      // biome-ignore lint/style/noRestrictedGlobals: Public chat routes lack Hono validators for typed RPC
      const startRes = await fetch(
        `/api/conversations/chat/${channelRoutingId}/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorToken }),
        },
      );

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
      storeConversationId(channelRoutingId, startData.conversationId);
      setConversationId(startData.conversationId);
      setLoading(false);
    } catch {
      setError('Failed to connect to chat');
      setLoading(false);
    }
  }, [channelRoutingId]);

  const retry = useCallback(() => {
    initRef.current = false;
    setError(null);
    setErrorRetryable(true);
    setLoading(true);
    initChat();
  }, [initChat]);

  const reset = useCallback(async () => {
    const visitorToken = getVisitorToken(channelRoutingId);
    try {
      setLoading(true);
      setError(null);
      // biome-ignore lint/style/noRestrictedGlobals: Public chat routes lack Hono validators for typed RPC
      const res = await fetch(
        `/api/conversations/chat/${channelRoutingId}/reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorToken }),
        },
      );

      if (!res.ok) {
        setError('Failed to reset conversation');
        setErrorRetryable(true);
        setLoading(false);
        return;
      }

      const data: StartResponse = await res.json();
      storeConversationId(channelRoutingId, data.conversationId);
      setConversationId(data.conversationId);
      setInitialMessages([]);
      setLoading(false);
    } catch {
      setError('Failed to reset conversation');
      setErrorRetryable(true);
      setLoading(false);
    }
  }, [channelRoutingId]);

  useEffect(() => {
    initChat();
  }, [initChat]);

  const visitorToken = getVisitorToken(channelRoutingId);

  return {
    conversationId,
    visitorToken,
    initialMessages,
    loading,
    error,
    errorRetryable,
    retry,
    reset,
  };
}
