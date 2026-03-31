import { createContext, type ReactNode, useContext } from 'react';

import type { NormalizedMessage } from '@/lib/normalize-message';
import type { MessageReactions } from './message-feedback';

interface VobaseThreadContextValue {
  viewMode: 'public' | 'staff';
  /** Original normalized messages for metadata access (internal notes, delivery status, turn labels) */
  messages: NormalizedMessage[];
  /** Feedback reactions per message */
  feedbackMap?: Map<string, MessageReactions>;
  /** Current user ID for highlighting own reactions */
  currentUserId?: string;
  /** Callback when user reacts to a message */
  onReact?: (
    messageId: string,
    rating: 'positive' | 'negative',
    reason?: string,
  ) => void;
  /** Callback to delete a specific feedback entry */
  onDeleteFeedback?: (messageId: string, feedbackId: string) => void;
  /** Contact label for turn grouping */
  contactLabel?: string;
  /** Conversation ID for typing indicator */
  conversationId?: string;
  /** Whether AI is currently thinking (public chat) */
  isAiThinking?: boolean;
}

const VobaseThreadContext = createContext<VobaseThreadContextValue | null>(
  null,
);

export function VobaseThreadProvider({
  children,
  ...value
}: VobaseThreadContextValue & { children: ReactNode }) {
  return (
    <VobaseThreadContext.Provider value={value}>
      {children}
    </VobaseThreadContext.Provider>
  );
}

export function useVobaseThread(): VobaseThreadContextValue | null {
  return useContext(VobaseThreadContext);
}
