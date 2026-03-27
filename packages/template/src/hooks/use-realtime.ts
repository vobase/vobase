import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected';

// Simple external store for SSE status so any component can read it
let _status: RealtimeStatus = 'connecting';
const _listeners = new Set<() => void>();

function setStatus(s: RealtimeStatus) {
  if (_status === s) return;
  _status = s;
  for (const fn of _listeners) fn();
}

function subscribe(fn: () => void) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function getSnapshot() {
  return _status;
}

/** Read the current SSE connection status from any component. */
export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'connecting');
}

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const isFirstConnect = useRef(true);

  useEffect(() => {
    setStatus('connecting');
    const es = new EventSource('/api/events');

    es.addEventListener('invalidate', (e) => {
      const { table } = JSON.parse(e.data);
      queryClient.invalidateQueries({ queryKey: [table] });
    });

    es.addEventListener('open', () => {
      setStatus('connected');
      if (isFirstConnect.current) {
        isFirstConnect.current = false;
        return;
      }
      // Reconnect — invalidate all to catch missed events
      queryClient.invalidateQueries();
    });

    es.addEventListener('error', () => {
      setStatus('disconnected');
      console.warn('[realtime] SSE connection error, reconnecting...');
    });

    return () => {
      es.close();
      setStatus('disconnected');
      isFirstConnect.current = true;
    };
  }, [queryClient]);
}
