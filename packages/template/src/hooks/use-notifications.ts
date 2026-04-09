import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { aiClient } from '@/lib/api-client';

/**
 * Track failed sessions that need attention.
 * Plays an audio alert when a new failure appears.
 * Relies on useRealtimeInvalidation() to auto-invalidate the query key.
 */
export function useEscalationNotifications() {
  const queryClient = useQueryClient();
  // -1 sentinel: skip alert on initial page load
  const prevCountRef = useRef(-1);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['interactions-list', 'alerts'],
    queryFn: async () => {
      const res = await aiClient.interactions.$get({
        query: { status: 'failed' },
      });
      if (!res.ok) return 0;
      const interactions: unknown[] = await res.json();
      return interactions.length;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (prevCountRef.current === -1) {
      // First fetch — store baseline, no alert
      prevCountRef.current = unreadCount;
      return;
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount]);

  const clearCount = () => {
    prevCountRef.current = 0;
    queryClient.setQueryData(['interactions-sessions', 'alerts'], 0);
  };

  return { unreadCount, clearCount };
}
