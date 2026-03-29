import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import type {
  MessageReactions,
  Reactor,
} from '@/components/chat/message-feedback';
import { subscribeToPayloads, type RealtimePayload } from '@/hooks/use-realtime';

interface FeedbackApiRow {
  messageId: string;
  rating: string;
  userId: string | null;
  userName: string | null;
  userImage: string | null;
}

function parseFeedbackRows(
  rows: FeedbackApiRow[],
): Map<string, MessageReactions> {
  const map = new Map<string, MessageReactions>();
  for (const r of rows) {
    if (!map.has(r.messageId)) {
      map.set(r.messageId, { positive: [], negative: [] });
    }
    const entry = map.get(r.messageId)!;
    const reactor: Reactor = {
      userId: r.userId ?? '',
      userName: r.userName,
      userImage: r.userImage,
    };
    if (r.rating === 'positive') entry.positive.push(reactor);
    else if (r.rating === 'negative') entry.negative.push(reactor);
  }
  return map;
}

async function fetchFeedback(
  conversationId: string,
): Promise<Map<string, MessageReactions>> {
  const res = await fetch(`/api/ai/conversations/${conversationId}/feedback`, {
    credentials: 'include',
  });
  if (!res.ok) return new Map();
  const rows: FeedbackApiRow[] = await res.json();
  return parseFeedbackRows(rows);
}

/**
 * Shared hook for message reactions — fetching, SSE sync, and mutation.
 * Uses TanStack Query for caching + SSE invalidation for realtime updates.
 */
export function useFeedback(conversationId: string) {
  const queryClient = useQueryClient();

  const { data: feedbackMap = new Map<string, MessageReactions>() } = useQuery({
    queryKey: ['conversations-feedback', conversationId],
    queryFn: () => fetchFeedback(conversationId),
    enabled: !!conversationId,
  });

  // SSE-based realtime sync
  useEffect(() => {
    const unsubscribe = subscribeToPayloads((payload: RealtimePayload) => {
      if (
        payload.table === 'conversations-feedback' &&
        payload.id === conversationId
      ) {
        queryClient.invalidateQueries({
          queryKey: ['conversations-feedback', conversationId],
        });
      }
    });
    return unsubscribe;
  }, [conversationId, queryClient]);

  const handleReact = useCallback(
    (messageId: string, rating: 'positive' | 'negative') => {
      fetch(
        `/api/ai/conversations/${conversationId}/messages/${messageId}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ rating }),
        },
      ).catch((err) => console.error('[feedback] reaction error:', err));
      // SSE invalidation handles the refetch — no need to manually reload
    },
    [conversationId],
  );

  return { feedbackMap, handleReact };
}
