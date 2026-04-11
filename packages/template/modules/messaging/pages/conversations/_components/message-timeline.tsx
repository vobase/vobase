import {
  CheckCircle2Icon,
  Loader2Icon,
  MessageSquareIcon,
  XCircleIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Button } from '@/components/ui/button';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { isTimelineVisibleEvent } from '@/lib/activity-helpers';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ActivityMessage } from './activity-message';
import { IncomingMessage } from './incoming-message';
import { OutgoingMessage } from './outgoing-message';
import type { MessageRow, SenderInfo, TimelineConversation } from './types';

// ─── Channel border colors ──────────────────────────────────────────

const CHANNEL_LINE_ACTIVE: Record<string, string> = {
  whatsapp: 'bg-emerald-500 dark:bg-emerald-400',
  email: 'bg-blue-500 dark:bg-blue-400',
  web: 'bg-violet-500 dark:bg-violet-400',
  voice: 'bg-amber-500 dark:bg-amber-400',
};

// ─── Date separator ──────────────────────────────────────────────────

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium text-muted-foreground">
        {formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' })}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Conversation outcome footer ─────────────────────────────────────

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return 'Resolved';
  return outcome.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function ConversationOutcome({
  conversation,
}: {
  conversation: TimelineConversation;
}) {
  const icon =
    conversation.status === 'failed' ? (
      <XCircleIcon className="h-3 w-3 text-destructive" />
    ) : (
      <CheckCircle2Icon className="h-3 w-3 text-emerald-500" />
    );

  const label =
    conversation.status === 'failed'
      ? 'Failed'
      : outcomeLabel(conversation.outcome);

  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <div className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {conversation.resolvedAt && (
          <span className="text-xs text-muted-foreground/60 ml-1">
            · <RelativeTimeCard date={conversation.resolvedAt} />
          </span>
        )}
      </div>
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
  /** When set, renders conversation boundary dividers between conversations. */
  timelineConversations?: TimelineConversation[];
  /** The conversation the user navigated from — used for scroll anchor. */
  currentConversationId?: string;
  /** Called when the topmost visible conversation changes (scroll tracking). */
  onConversationChange?: (conversationId: string) => void;
  /** Maps conversationId → channelType for segment coloring. */
  conversationChannelMap?: Map<string, string>;
  /** The currently active (sticky) conversation — gets colored border. */
  activeConversationId?: string;
  /** Current logged-in user ID — their messages align right (WhatsApp style). */
  currentUserId?: string;
  /** When true, shows channel badge on each message (multi-channel contacts). */
  isMultiChannel?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────

export const MessageTimeline = memo(function MessageTimeline({
  messages,
  senderMap,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onRetryMessage,
  timelineConversations,
  currentConversationId,
  onConversationChange,
  conversationChannelMap,
  activeConversationId,
  currentUserId,
  isMultiChannel,
}: MessageTimelineProps) {
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const currentAnchorRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Use refs so callbacks stay stable
  const stateRef = useRef({ hasMore, isFetchingMore, onLoadMore });
  stateRef.current = { hasMore, isFetchingMore, onLoadMore };

  const onConversationChangeRef = useRef(onConversationChange);
  onConversationChangeRef.current = onConversationChange;

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

  // Auto-scroll to current conversation's first message on initial load
  useEffect(() => {
    if (hasScrolledRef.current || !currentAnchorRef.current) return;
    hasScrolledRef.current = true;
    currentAnchorRef.current.scrollIntoView({ block: 'start' });
  }, []);

  // Track which conversation is at the top of the scroll area via scroll events.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when messages change
  useEffect(() => {
    if (!onConversationChangeRef.current) return;

    const el = topSentinelRef.current;
    if (!el) return;

    // Find the actual scrollable ancestor (StickToBottom creates one internally)
    let scrollEl: HTMLElement | null = el.parentElement;
    while (scrollEl) {
      const { overflow, overflowY } = getComputedStyle(scrollEl);
      if (/(auto|scroll)/.test(overflow + overflowY)) break;
      scrollEl = scrollEl.parentElement;
    }
    if (!scrollEl) return;

    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const sentinels = scrollEl.querySelectorAll<HTMLElement>(
          '[data-conversation-sentinel]',
        );
        if (sentinels.length === 0) return;

        const containerTop = scrollEl.getBoundingClientRect().top;
        const containerHeight = scrollEl.clientHeight;
        const scrollMax = scrollEl.scrollHeight - containerHeight;

        // Pinned to very bottom — activate last sentinel, but only when
        // there's meaningful scroll range (>50px). Avoids locking to the
        // last conversation when all content fits on screen.
        const atBottom = scrollMax > 50 && scrollMax - scrollEl.scrollTop < 8;
        if (atBottom) {
          const lastId =
            sentinels[sentinels.length - 1].dataset.conversationSentinel ??
            null;
          if (lastId) {
            onConversationChangeRef.current?.(lastId);
            return;
          }
        }

        // Fixed focal line at 1/3 of viewport — natural reading position.
        // Edge cases handled by atBottom (above) and lastVisibleId fallback.
        // When content fits on screen (no scroll), use 85% to default to
        // the most recent conversation.
        const focalLine =
          scrollMax > 0 ? containerHeight * 0.33 : containerHeight * 0.85;

        let activeId: string | null = null;
        let lastVisibleId: string | null = null;

        for (const s of sentinels) {
          const top = s.getBoundingClientRect().top - containerTop;
          if (top <= focalLine) {
            activeId = s.dataset.conversationSentinel ?? null;
          }
          if (top < containerHeight) {
            lastVisibleId = s.dataset.conversationSentinel ?? null;
          }
        }

        if (!activeId) {
          activeId = lastVisibleId;
        }

        if (!activeId && sentinels.length > 0) {
          activeId = sentinels[0].dataset.conversationSentinel ?? null;
        }

        if (activeId) {
          onConversationChangeRef.current?.(activeId);
        }
      });
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [messages]);

  const sorted = useMemo(
    () =>
      [...messages]
        .filter(
          (msg) =>
            msg.messageType !== 'activity' ||
            isTimelineVisibleEvent(
              ((msg.contentData as Record<string, unknown>)
                ?.eventType as string) ?? msg.content,
            ),
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
    [messages],
  );

  // Build conversation map for lookups
  const conversationMap = useMemo(() => {
    if (!timelineConversations) return null;
    const map = new Map<string, TimelineConversation>();
    for (const ti of timelineConversations) {
      map.set(ti.id, ti);
    }
    return map;
  }, [timelineConversations]);

  // Build conversation groups: each conversation becomes a bordered box
  // containing all its messages (with date separators inline).
  type ConversationGroup = {
    conversationId: string;
    conversation: TimelineConversation | null;
    channelType: string | undefined;
    /** Date separator to render before the bordered box (first date of this conversation). */
    leadingDate: string | null;
    items: Array<
      { type: 'date'; date: string } | { type: 'msg'; msg: MessageRow }
    >;
    isScrollAnchor: boolean;
    isTerminal: boolean;
  };

  const groups = useMemo(() => {
    const result: ConversationGroup[] = [];
    const seenConversations = new Set<string>();
    let lastDate = '';

    // Group messages by conversation (preserving order)
    let currentGroup: ConversationGroup | null = null;

    for (const msg of sorted) {
      const msgDate = new Date(msg.createdAt).toDateString();
      const isNewConversation =
        !currentGroup || msg.conversationId !== currentGroup.conversationId;

      if (isNewConversation) {
        const conversation = conversationMap?.get(msg.conversationId) ?? null;
        const isFirst = !seenConversations.has(msg.conversationId);
        seenConversations.add(msg.conversationId);

        const needsDate = msgDate !== lastDate;
        if (needsDate) lastDate = msgDate;

        currentGroup = {
          conversationId: msg.conversationId,
          conversation,
          channelType: conversationChannelMap?.get(msg.conversationId),
          leadingDate: needsDate ? msg.createdAt : null,
          items: [],
          isScrollAnchor:
            !!currentConversationId &&
            msg.conversationId === currentConversationId &&
            isFirst,
          isTerminal:
            conversation?.status === 'resolved' ||
            conversation?.status === 'failed',
        };
        result.push(currentGroup);
      } else {
        // Same conversation — inline date separator if date changed
        if (msgDate !== lastDate) {
          currentGroup?.items.push({ type: 'date', date: msg.createdAt });
          lastDate = msgDate;
        }
      }

      currentGroup?.items.push({ type: 'msg', msg });
    }

    return result;
  }, [sorted, conversationMap, currentConversationId, conversationChannelMap]);

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

        {groups.map((group) => {
          const isActive = group.conversationId === activeConversationId;
          const activeLine = group.channelType
            ? CHANNEL_LINE_ACTIVE[group.channelType]
            : undefined;

          return (
            <div key={`ix-${group.conversationId}`}>
              {/* Scroll sentinel */}
              <div
                data-conversation-sentinel={group.conversationId}
                className="h-0"
              />
              {/* Scroll anchor for initial load */}
              {group.isScrollAnchor && (
                <div ref={currentAnchorRef} className="h-0" />
              )}

              {/* Conversation segment with positioned vertical line */}
              <div className="relative pl-4">
                {/* Vertical line — positioned to start/end at divider centerlines */}
                <div
                  className={cn(
                    'absolute left-0 w-0.5 rounded-full transition-colors duration-150',
                    isActive && activeLine ? activeLine : 'bg-border',
                  )}
                  style={{
                    top: group.leadingDate ? '0.5rem' : 0,
                    bottom: group.isTerminal ? '0.75rem' : 0,
                  }}
                />

                {/* Leading date separator */}
                {group.leadingDate && (
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {formatDate(group.leadingDate, {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}

                {/* Messages with inline date separators */}
                <div className="flex flex-col gap-6">
                  {group.items.map((item) =>
                    item.type === 'date' ? (
                      <div key={`date-${item.date}`}>
                        <DateSeparator date={item.date} />
                      </div>
                    ) : (
                      <MessageItem
                        key={item.msg.id}
                        message={item.msg}
                        senderMap={senderMap}
                        onRetry={onRetryMessage}
                        currentUserId={currentUserId}
                        isMultiChannel={isMultiChannel}
                      />
                    ),
                  )}
                </div>

                {/* Outcome footer */}
                {group.isTerminal && group.conversation && (
                  <div className="mt-4">
                    <ConversationOutcome conversation={group.conversation} />
                  </div>
                )}
              </div>
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
  currentUserId,
  isMultiChannel,
}: {
  message: MessageRow;
  senderMap?: Map<string, SenderInfo>;
  onRetry?: (messageId: string) => void;
  currentUserId?: string;
  isMultiChannel?: boolean;
}) {
  const sender = senderMap?.get(message.senderId);

  if (message.messageType === 'activity') {
    return <ActivityMessage message={message} />;
  }

  // WhatsApp-style: only current staff's messages go right
  const isMe =
    !!currentUserId &&
    message.senderType === 'user' &&
    message.senderId === currentUserId;

  const channelType = isMultiChannel ? message.channelType : undefined;

  if (isMe) {
    // Current staff → right-aligned (like "my" messages in WhatsApp)
    return (
      <OutgoingMessage
        message={message}
        sender={sender}
        onRetry={onRetry}
        align="right"
        channelType={channelType}
      />
    );
  }

  if (message.messageType === 'incoming') {
    return (
      <IncomingMessage
        message={message}
        sender={sender}
        channelType={channelType}
      />
    );
  }

  // Agent, other staff, system → left-aligned
  return (
    <OutgoingMessage
      message={message}
      sender={sender}
      onRetry={onRetry}
      channelType={channelType}
    />
  );
});
