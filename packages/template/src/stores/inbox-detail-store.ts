import { create } from 'zustand';

interface InboxDetailState {
  // ── Identity ──
  contactId: string | null;

  // ── Channel selection (for "new message" flow when all conversations terminal) ──
  selectedChannelId: string | null;

  // ── Tab channel selection (for channel tabs in detail view) ──
  selectedTabChannelId: string | null;

  // ── Block expand/collapse ──
  expandedConversationIds: Set<string>;

  // ── Actions ──
  /** Called when URL contactId changes. Resets all per-contact state. */
  switchContact: (contactId: string) => void;

  /** Called from channel picker. */
  selectChannel: (channelId: string) => void;

  /** Called when user switches channel tab in detail view. */
  selectTabChannel: (channelId: string | null) => void;

  /** Toggle a block open/closed. */
  toggleBlock: (id: string) => void;

  /** Expand a specific block. */
  expandBlock: (id: string) => void;

  /** Collapse a specific block. */
  collapseBlock: (id: string) => void;

  /** Called when timeline data loads — expands active conversations, collapses resolved/failed. */
  setDefaultExpansion: (
    conversations: Array<{ id: string; status: string }>,
  ) => void;
}

export const useInboxDetailStore = create<InboxDetailState>((set) => ({
  contactId: null,
  selectedChannelId: null,
  selectedTabChannelId: null,
  expandedConversationIds: new Set(),

  switchContact: (contactId) =>
    set({
      contactId,
      selectedChannelId: null,
      selectedTabChannelId: null,
      expandedConversationIds: new Set(),
    }),

  selectChannel: (channelId) => set({ selectedChannelId: channelId }),

  selectTabChannel: (channelId) => set({ selectedTabChannelId: channelId }),

  toggleBlock: (id) =>
    set((state) => {
      const next = new Set(state.expandedConversationIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedConversationIds: next };
    }),

  expandBlock: (id) =>
    set((state) => {
      if (state.expandedConversationIds.has(id)) return state;
      return {
        expandedConversationIds: new Set([
          ...state.expandedConversationIds,
          id,
        ]),
      };
    }),

  collapseBlock: (id) =>
    set((state) => {
      if (!state.expandedConversationIds.has(id)) return state;
      const next = new Set(state.expandedConversationIds);
      next.delete(id);
      return { expandedConversationIds: next };
    }),

  setDefaultExpansion: (conversations) =>
    set({
      expandedConversationIds: new Set(
        conversations.filter((i) => i.status === 'active').map((i) => i.id),
      ),
    }),
}));
