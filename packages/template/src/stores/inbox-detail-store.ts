import { create } from 'zustand';

interface InboxDetailState {
  // ── Identity ──
  contactId: string | null;

  // ── Channel selection (for "new message" flow when all interactions terminal) ──
  selectedChannelId: string | null;

  // ── Block expand/collapse ──
  expandedInteractionIds: Set<string>;

  // ── View mode ──
  viewMode: 'threads' | 'timeline';

  // ── Actions ──
  /** Called when URL contactId changes. Resets all per-contact state. */
  switchContact: (contactId: string) => void;

  /** Called from channel picker. */
  selectChannel: (channelId: string) => void;

  /** Toggle a block open/closed. */
  toggleBlock: (id: string) => void;

  /** Expand a specific block. */
  expandBlock: (id: string) => void;

  /** Collapse a specific block. */
  collapseBlock: (id: string) => void;

  /** Called when timeline data loads — expands active interactions, collapses resolved/failed. */
  setDefaultExpansion: (
    interactions: Array<{ id: string; status: string }>,
  ) => void;

  /** Switch between threads and timeline view. */
  setViewMode: (mode: 'threads' | 'timeline') => void;
}

export const useInboxDetailStore = create<InboxDetailState>((set) => ({
  contactId: null,
  selectedChannelId: null,
  expandedInteractionIds: new Set(),
  viewMode: 'threads',

  switchContact: (contactId) =>
    set({
      contactId,
      selectedChannelId: null,
      expandedInteractionIds: new Set(),
      viewMode: 'threads',
    }),

  selectChannel: (channelId) => set({ selectedChannelId: channelId }),

  toggleBlock: (id) =>
    set((state) => {
      const next = new Set(state.expandedInteractionIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedInteractionIds: next };
    }),

  expandBlock: (id) =>
    set((state) => {
      if (state.expandedInteractionIds.has(id)) return state;
      return {
        expandedInteractionIds: new Set([...state.expandedInteractionIds, id]),
      };
    }),

  collapseBlock: (id) =>
    set((state) => {
      if (!state.expandedInteractionIds.has(id)) return state;
      const next = new Set(state.expandedInteractionIds);
      next.delete(id);
      return { expandedInteractionIds: next };
    }),

  setDefaultExpansion: (interactions) =>
    set({
      expandedInteractionIds: new Set(
        interactions.filter((i) => i.status === 'active').map((i) => i.id),
      ),
    }),

  setViewMode: (mode) => set({ viewMode: mode }),
}));
