import { useCallback, useEffect, useRef, useState } from 'react';

import { agentsClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';

// ─── Types ────────────────────────────────────────────────────────────

interface StartResponse {
  conversationId: string;
  agentId: string | null;
}

interface UsePublicChatResult {
  conversationId: string | null;
  loading: boolean;
  error: string | null;
  errorRetryable: boolean;
  retry: () => void;
  newTopic: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getStoredConversationId(channelRoutingId: string): string | null {
  return localStorage.getItem(`vobase-conversation-${channelRoutingId}`);
}

function storeConversationId(channelRoutingId: string, conversationId: string) {
  localStorage.setItem(
    `vobase-conversation-${channelRoutingId}`,
    conversationId,
  );
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

      const storedId = getStoredConversationId(channelRoutingId);

      // Try to resume existing conversation
      if (storedId) {
        try {
          const res = await agentsClient.chat[
            ':channelRoutingId'
          ].conversations[':conversationId'].$get({
            param: {
              channelRoutingId,
              conversationId: storedId,
            },
          });
          if (res.ok) {
            setConversationId(storedId);
            setLoading(false);
            return;
          }
        } catch {
          // Failed to resume — start fresh
        }
      }

      // Start new conversation
      const startRes = await agentsClient.chat[':channelRoutingId'].start.$post(
        {
          param: { channelRoutingId },
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

      const startData = (await startRes.json()) as StartResponse;
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

  const newTopic = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await agentsClient.chat[':channelRoutingId'].reset.$post({
        param: { channelRoutingId },
      });

      if (!res.ok) {
        setError('Failed to start new topic');
        setErrorRetryable(true);
        setLoading(false);
        return;
      }

      const data = (await res.json()) as StartResponse;
      storeConversationId(channelRoutingId, data.conversationId);
      setConversationId(data.conversationId);
      setLoading(false);
    } catch {
      setError('Failed to start new topic');
      setErrorRetryable(true);
      setLoading(false);
    }
  }, [channelRoutingId]);

  // Reset init guard when channelRoutingId changes (e.g. route navigation)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on channelRoutingId change
  useEffect(() => {
    initRef.current = false;
  }, [channelRoutingId]);

  useEffect(() => {
    initChat();
  }, [initChat]);

  return {
    conversationId,
    loading,
    error,
    errorRetryable,
    retry,
    newTopic,
  };
}
