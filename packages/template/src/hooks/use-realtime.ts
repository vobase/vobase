import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const isFirstConnect = useRef(true);

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('invalidate', (e) => {
      const { table } = JSON.parse(e.data);
      queryClient.invalidateQueries({ queryKey: [table] });
    });

    es.addEventListener('open', () => {
      if (isFirstConnect.current) {
        isFirstConnect.current = false;
        return;
      }
      // Reconnect — invalidate all to catch missed events
      queryClient.invalidateQueries();
    });

    es.addEventListener('error', () => {
      console.warn('[realtime] SSE connection error, reconnecting...');
    });

    return () => {
      es.close();
      isFirstConnect.current = true;
    };
  }, [queryClient]);
}
