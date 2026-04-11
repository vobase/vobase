import { create } from 'zustand';

interface TypingUser {
  name: string;
  expiresAt: number;
}

interface StaffChatState {
  /** Typing indicators: conversationId → Map<userId, TypingUser> */
  typingUsers: Map<string, Map<string, TypingUser>>;
  addTypingUser: (conversationId: string, userId: string, name: string) => void;
  removeTypingUser: (conversationId: string, userId: string) => void;
  getTypingUsers: (conversationId: string) => { name: string }[];

  /** Read status: conversationId -> last read messageId */
  lastReadMessageId: Map<string, string>;
  setLastRead: (conversationId: string, messageId: string) => void;

  /** KB curation mode (Phase 3) */
  kbCurationActive: boolean;
  kbSelectedMessages: Set<string>;
  toggleKbCuration: () => void;
  toggleKbMessage: (messageId: string) => void;
  clearKbSelection: () => void;
}

const TYPING_TTL_MS = 3000;

export const useStaffChatStore = create<StaffChatState>((set, get) => ({
  typingUsers: new Map(),

  addTypingUser: (conversationId, userId, name) => {
    set((state) => {
      const next = new Map(state.typingUsers);
      const convMap = new Map(next.get(conversationId) ?? []);
      convMap.set(userId, { name, expiresAt: Date.now() + TYPING_TTL_MS });
      next.set(conversationId, convMap);
      return { typingUsers: next };
    });
  },

  removeTypingUser: (conversationId, userId) => {
    set((state) => {
      const next = new Map(state.typingUsers);
      const convMap = next.get(conversationId);
      if (convMap) {
        const updated = new Map(convMap);
        updated.delete(userId);
        next.set(conversationId, updated);
      }
      return { typingUsers: next };
    });
  },

  getTypingUsers: (conversationId) => {
    const convMap = get().typingUsers.get(conversationId);
    if (!convMap) return [];
    const now = Date.now();
    const active: { name: string }[] = [];
    for (const [, user] of convMap) {
      if (user.expiresAt > now) {
        active.push({ name: user.name });
      }
    }
    return active;
  },

  lastReadMessageId: new Map(),

  setLastRead: (conversationId, messageId) => {
    set((state) => {
      const next = new Map(state.lastReadMessageId);
      next.set(conversationId, messageId);
      return { lastReadMessageId: next };
    });
  },

  kbCurationActive: false,
  kbSelectedMessages: new Set(),

  toggleKbCuration: () => {
    set((state) => ({
      kbCurationActive: !state.kbCurationActive,
      kbSelectedMessages: state.kbCurationActive
        ? new Set<string>()
        : state.kbSelectedMessages,
    }));
  },

  toggleKbMessage: (messageId) => {
    set((state) => {
      const next = new Set(state.kbSelectedMessages);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return { kbSelectedMessages: next };
    });
  },

  clearKbSelection: () => {
    set({ kbSelectedMessages: new Set(), kbCurationActive: false });
  },
}));
