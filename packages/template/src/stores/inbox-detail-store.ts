import { create } from 'zustand'

/** Sentinel value for the "All channels" tab (distinct from null = no selection yet). */
export const CHANNEL_TAB_ALL = '__all__'

interface InboxDetailState {
  // ── Identity ──
  contactId: string | null

  // ── Channel tab (which channel's timeline is shown; null = "All") ──
  channelTab: string | null

  // ── Channel selection (for "new message" flow when all conversations terminal) ──
  selectedChannelId: string | null

  // ── Block expand/collapse ──
  expandedConversationIds: Set<string>

  // ── Actions ──
  switchContact: (contactId: string) => void
  setChannelTab: (channelId: string | null) => void
  selectChannel: (channelId: string) => void
  toggleBlock: (id: string) => void
  expandBlock: (id: string) => void
  collapseBlock: (id: string) => void
  setDefaultExpansion: (conversations: Array<{ id: string; status: string }>) => void
}

export const useInboxDetailStore = create<InboxDetailState>((set) => ({
  contactId: null,
  channelTab: null,
  selectedChannelId: null,
  expandedConversationIds: new Set(),

  switchContact: (contactId) =>
    set({
      contactId,
      channelTab: null,
      selectedChannelId: null,
      expandedConversationIds: new Set(),
    }),

  setChannelTab: (channelId) => set({ channelTab: channelId }),

  selectChannel: (channelId) => set({ selectedChannelId: channelId }),

  toggleBlock: (id) =>
    set((state) => {
      const next = new Set(state.expandedConversationIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedConversationIds: next }
    }),

  expandBlock: (id) =>
    set((state) => {
      if (state.expandedConversationIds.has(id)) return state
      return {
        expandedConversationIds: new Set([...state.expandedConversationIds, id]),
      }
    }),

  collapseBlock: (id) =>
    set((state) => {
      if (!state.expandedConversationIds.has(id)) return state
      const next = new Set(state.expandedConversationIds)
      next.delete(id)
      return { expandedConversationIds: next }
    }),

  setDefaultExpansion: (conversations) =>
    set({
      expandedConversationIds: new Set(conversations.filter((i) => i.status === 'active').map((i) => i.id)),
    }),
}))
