import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import type {
  MessageReactions,
  Reactor,
} from '@/components/chat/message-feedback';
import {
  type RealtimePayload,
  subscribeToPayloads,
} from '@/hooks/use-realtime';
import { messagingClient } from '@/lib/api-client';

interface FeedbackApiRow {
  id: string;
  messageId: string;
  rating: string;
  reason: string | null;
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
    // biome-ignore lint/style/noNonNullAssertion: set on previous line
    const entry = map.get(r.messageId)!;
    const reactor: Reactor = {
      id: r.id,
      userId: r.userId ?? '',
      userName: r.userName,
      userImage: r.userImage,
      reason: r.reason,
    };
    if (r.rating === 'positive') entry.positive.push(reactor);
    else if (r.rating === 'negative') entry.negative.push(reactor);
  }
  return map;
}

async function fetchFeedback(
  conversationId: string,
): Promise<Map<string, MessageReactions>> {
  const res = await messagingClient.conversations[':id'].feedback.$get({
    param: { id: conversationId },
  });
  if (!res.ok) return new Map();
  const rows = (await res.json()) as FeedbackApiRow[];
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

  const reactMutation = useMutation({
    mutationFn: async ({
      messageId,
      rating,
      reason,
    }: {
      messageId: string;
      rating: 'positive' | 'negative';
      reason?: string;
    }) => {
      const res = await messagingClient.conversations[':id'].messages[
        ':messageId'
      ].feedback.$post(
        { param: { id: conversationId, messageId } },
        {
          headers: { 'Content-Type': 'application/json' },
          init: {
            body: JSON.stringify({ rating, ...(reason && { reason }) }),
          },
        },
      );
      if (!res.ok) throw new Error('Failed to add feedback');
      return res.json();
    },
    onError: (err) => console.error('[feedback] reaction error:', err),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({
      messageId,
      feedbackId,
    }: {
      messageId: string;
      feedbackId: string;
    }) => {
      const res = await messagingClient.conversations[':id'].messages[
        ':messageId'
      ].feedback[':feedbackId'].$delete({
        param: { id: conversationId, messageId, feedbackId },
      });
      if (!res.ok) throw new Error('Failed to delete feedback');
      return res.json();
    },
    onError: (err) => console.error('[feedback] delete error:', err),
  });

  const handleReact = useCallback(
    (messageId: string, rating: 'positive' | 'negative', reason?: string) => {
      reactMutation.mutate({ messageId, rating, reason });
    },
    [reactMutation],
  );

  const handleDeleteFeedback = useCallback(
    (messageId: string, feedbackId: string) => {
      deleteMutation.mutate({ messageId, feedbackId });
    },
    [deleteMutation],
  );

  return { feedbackMap, handleReact, handleDeleteFeedback };
}
