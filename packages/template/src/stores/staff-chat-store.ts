import { create } from 'zustand';

interface TypingUser {
  name: string;
  expiresAt: number;
}

interface StaffChatState {
  /** Typing indicators: interactionId -> Map<userId, TypingUser> */
  typingUsers: Map<string, Map<string, TypingUser>>;
  addTypingUser: (interactionId: string, userId: string, name: string) => void;
  removeTypingUser: (interactionId: string, userId: string) => void;
  getTypingUsers: (interactionId: string) => { name: string }[];

  /** Read status: interactionId -> last read messageId */
  lastReadMessageId: Map<string, string>;
  setLastRead: (interactionId: string, messageId: string) => void;

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

  addTypingUser: (interactionId, userId, name) => {
    set((state) => {
      const next = new Map(state.typingUsers);
      const convMap = new Map(next.get(interactionId) ?? []);
      convMap.set(userId, { name, expiresAt: Date.now() + TYPING_TTL_MS });
      next.set(interactionId, convMap);
      return { typingUsers: next };
    });
  },

  removeTypingUser: (interactionId, userId) => {
    set((state) => {
      const next = new Map(state.typingUsers);
      const convMap = next.get(interactionId);
      if (convMap) {
        const updated = new Map(convMap);
        updated.delete(userId);
        next.set(interactionId, updated);
      }
      return { typingUsers: next };
    });
  },

  getTypingUsers: (interactionId) => {
    const convMap = get().typingUsers.get(interactionId);
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

  setLastRead: (interactionId, messageId) => {
    set((state) => {
      const next = new Map(state.lastReadMessageId);
      next.set(interactionId, messageId);
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
