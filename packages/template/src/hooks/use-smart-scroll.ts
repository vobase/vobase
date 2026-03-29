import { useEffect, useRef, useState } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

interface SmartScrollState {
  /** Number of new messages received while user was scrolled up */
  newMessageCount: number;
  /** Whether user is at the bottom (from StickToBottom context) */
  isAtBottom: boolean;
  /** Reset counter (called when user scrolls to bottom or clicks pill) */
  resetNewMessages: () => void;
}

/**
 * Must be called inside a StickToBottom.Content descendant.
 * Uses useStickToBottomContext().isAtBottom to detect scroll position.
 * Counts new messages while !isAtBottom.
 */
export function useSmartScroll(messageCount: number): SmartScrollState {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const [newMessageCount, setNewMessageCount] = useState(0);
  const prevCountRef = useRef(messageCount);

  useEffect(() => {
    const diff = messageCount - prevCountRef.current;
    prevCountRef.current = messageCount;

    if (diff > 0 && !isAtBottom) {
      setNewMessageCount((prev) => prev + diff);
    }
  }, [messageCount, isAtBottom]);

  // Reset when user scrolls back to bottom
  useEffect(() => {
    if (isAtBottom && newMessageCount > 0) {
      setNewMessageCount(0);
    }
  }, [isAtBottom, newMessageCount]);

  const resetNewMessages = () => {
    setNewMessageCount(0);
    scrollToBottom();
  };

  return {
    newMessageCount,
    isAtBottom,
    resetNewMessages,
  };
}
