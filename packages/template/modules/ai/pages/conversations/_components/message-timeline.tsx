import { Loader2Icon, MessageSquareIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Button } from '@/components/ui/button';
import { isTimelineVisibleEvent } from '@/lib/activity-helpers';
import { formatDate } from '@/lib/format';
import { ActivityMessage } from './activity-message';
import { IncomingMessage } from './incoming-message';
import { OutgoingMessage } from './outgoing-message';
import type { MessageRow, SenderInfo } from './types';

// ─── Date separator ──────────────────────────────────────────────────

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium text-muted-foreground">
        {formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' })}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────

interface MessageTimelineProps {
  messages: MessageRow[];
  senderMap?: Map<string, SenderInfo>;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  onRetryMessage?: (messageId: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────

export const MessageTimeline = memo(function MessageTimeline({
  messages,
  senderMap,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onRetryMessage,
}: MessageTimelineProps) {
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // Use refs so the IntersectionObserver callback stays stable
  const stateRef = useRef({ hasMore, isFetchingMore, onLoadMore });
  stateRef.current = { hasMore, isFetchingMore, onLoadMore };

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        const { hasMore, isFetchingMore, onLoadMore } = stateRef.current;
        if (entry.isIntersecting && hasMore && !isFetchingMore) {
          onLoadMore();
        }
      },
      { rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const sorted = useMemo(
    () =>
      [...messages]
        .filter(
          (msg) =>
            msg.messageType !== 'activity' ||
            isTimelineVisibleEvent(msg.content),
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
    [messages],
  );

  // Group by date for separators
  let lastDate = '';

  return (
    <Conversation className="h-full">
      <ConversationContent className="gap-6 px-4 py-4">
        {/* Load more sentinel */}
        <div ref={topSentinelRef} className="h-px shrink-0" />

        {isFetchingMore && (
          <div className="flex justify-center py-2">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {hasMore && !isFetchingMore && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={onLoadMore}
            >
              Load earlier messages
            </Button>
          </div>
        )}

        {sorted.length === 0 && (
          <ConversationEmptyState
            icon={<MessageSquareIcon className="size-6" />}
            title="No messages yet"
            description="Messages will appear here when the conversation starts"
          />
        )}

        {sorted.map((msg) => {
          const msgDate = new Date(msg.createdAt).toDateString();
          const showDate = msgDate !== lastDate;
          lastDate = msgDate;

          return (
            <div key={msg.id}>
              {showDate && <DateSeparator date={msg.createdAt} />}
              <MessageItem
                message={msg}
                senderMap={senderMap}
                onRetry={onRetryMessage}
              />
            </div>
          );
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
});

// ─── Single message dispatcher ──────────────────────────────────────

const MessageItem = memo(function MessageItem({
  message,
  senderMap,
  onRetry,
}: {
  message: MessageRow;
  senderMap?: Map<string, SenderInfo>;
  onRetry?: (messageId: string) => void;
}) {
  const sender = senderMap?.get(message.senderId);

  if (message.messageType === 'activity') {
    return <ActivityMessage message={message} />;
  }

  if (message.messageType === 'incoming') {
    return <IncomingMessage message={message} sender={sender} />;
  }

  // outgoing — agent, staff, or system
  return (
    <OutgoingMessage message={message} sender={sender} onRetry={onRetry} />
  );
});
