import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { hasStaffPrefix } from '@/lib/normalize-message';

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

function isStaffReply(m: ConversationMessages['messages'][number]): boolean {
  return (
    m.role === 'assistant' &&
    m.parts.some((p) => p.type === 'text' && hasStaffPrefix(p.text ?? ''))
  );
}

/**
 * Process messages for public chat display:
 * Insert invisible separator between AI + staff assistant messages
 * so useChat doesn't merge them into one turn.
 */
export function preparePublicMessages(
  messages: ConversationMessages['messages'],
): UIMessage[] {
  const result: UIMessage[] = [];
  let prevStaff = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const staff = isStaffReply(m);

    // Insert separator between consecutive assistant messages when either involves staff
    if (
      i > 0 &&
      m.role === 'assistant' &&
      messages[i - 1].role === 'assistant' &&
      (staff || prevStaff)
    ) {
      result.push({
        id: `sep-${m.id}`,
        role: 'user',
        parts: [{ type: 'text', text: '' }],
      });
    }

    result.push({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      parts: m.parts as UIMessage['parts'],
    });
    prevStaff = staff;
  }
  return result;
}

interface UsePublicChatResult {
  conversationId: string | null;
  initialMessages: UIMessage[];
  loading: boolean;
  error: string | null;
  errorRetryable: boolean;
  retry: () => void;
  reset: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getStoredConversationId(channelRoutingId: string): string | null {
  return localStorage.getItem(`vobase-conv-${channelRoutingId}`);
}

function storeConversationId(channelRoutingId: string, conversationId: string) {
  localStorage.setItem(`vobase-conv-${channelRoutingId}`, conversationId);
}

/**
 * Ensure the visitor has an anonymous session.
 * If already signed in (anonymous or real), returns the existing session.
 * Otherwise, signs in anonymously via better-auth.
 */
async function ensureAnonymousSession(): Promise<void> {
  const { data: session } = await authClient.getSession();
  if (session) return;
  await authClient.signIn.anonymous();
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
      // Sign in anonymously if no session exists
      await ensureAnonymousSession();

      const storedConvId = getStoredConversationId(channelRoutingId);

      // Try to resume existing conversation
      if (storedConvId) {
        try {
          const res = await fetch(
            `/api/ai/chat/${channelRoutingId}/conversations/${storedConvId}`,
            { credentials: 'include' },
          );
          if (res.ok) {
            const data: ConversationMessages = await res.json();
            const uiMessages = preparePublicMessages(data.messages);
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
      const startRes = await fetch(`/api/ai/chat/${channelRoutingId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
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
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/ai/chat/${channelRoutingId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

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

  return {
    conversationId,
    initialMessages,
    loading,
    error,
    errorRetryable,
    retry,
    reset,
  };
}
