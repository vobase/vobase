import { CheckIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { memo, type RefObject } from 'react';

import { AssigneeBadge } from '@/components/conversation-badges';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { filterAndSortMessages } from '../../../lib/filter-sort-messages';
import { BlockReplyInput } from '../../conversations/_components/block-reply-input';
import { BlockMessageItem } from '../../conversations/_components/conversation-block';
import type {
  MessageRow,
  SenderInfo,
  TimelineConversationFull,
} from '../../conversations/_components/types';

interface FlatTimelineProps {
  channelFlatMessages: Array<MessageRow & { _conversationId: string }>;
  conversationBoundaries: Set<string>;
  filteredConversations: TimelineConversationFull[];
  activeChannelConversation: TimelineConversationFull | null;
  selectedChannel: { id: string; type: string; label: string | null } | null;
  selectedTabChannelId: string;
  senderMap: Map<string, SenderInfo>;
  currentUserId?: string;
  agents: Array<{ id: string; name: string }>;
  contactLoading: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onReply: (
    conversationId: string,
    content: string,
    isInternal: boolean,
  ) => void;
  onNewConversation: (
    channelInstanceId: string,
    content: string,
    isInternal: boolean,
  ) => void;
  onRetry: (conversationId: string, messageId: string) => void;
  onUpdateConversation: (id: string, body: Record<string, unknown>) => void;
  replyPending: boolean;
  replyError: boolean;
  newConversationPending: boolean;
  newConversationError: boolean;
}

export const FlatTimeline = memo(function FlatTimeline({
  channelFlatMessages,
  conversationBoundaries,
  filteredConversations,
  activeChannelConversation,
  selectedChannel,
  selectedTabChannelId,
  senderMap,
  currentUserId,
  agents,
  contactLoading,
  scrollRef,
  onReply,
  onNewConversation,
  onRetry,
  onUpdateConversation,
  replyPending,
  replyError,
  newConversationPending,
  newConversationError,
}: FlatTimelineProps) {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Conversation action bar */}
      <div
        className={`flex items-center gap-2 border-b px-4 py-1.5 bg-muted/20 ${!activeChannelConversation ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <AssigneeBadge
          assignee={activeChannelConversation?.assignee ?? null}
          variant="field"
          onSelect={(v) =>
            activeChannelConversation &&
            onUpdateConversation(activeChannelConversation.id, { assignee: v })
          }
          agents={agents}
        />
        <div className="flex-1" />
        <Button
          variant={activeChannelConversation?.onHold ? 'secondary' : 'ghost'}
          size="sm"
          disabled={!activeChannelConversation}
          className={`h-7 gap-1.5 text-xs ${activeChannelConversation?.onHold ? 'text-amber-600 dark:text-amber-400' : ''}`}
          onClick={() =>
            activeChannelConversation &&
            onUpdateConversation(activeChannelConversation.id, {
              onHold: !activeChannelConversation.onHold,
            })
          }
        >
          {activeChannelConversation?.onHold ? (
            <>
              <PlayIcon className="h-3 w-3" />
              Resume
            </>
          ) : (
            <>
              <PauseIcon className="h-3 w-3" />
              Hold
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!activeChannelConversation}
          className="h-7 gap-1.5 text-xs"
          onClick={() =>
            activeChannelConversation &&
            onUpdateConversation(activeChannelConversation.id, {
              status: 'resolved',
            })
          }
        >
          <CheckIcon className="h-3 w-3" />
          Resolve
        </Button>
      </div>

      {/* Flat message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 flex flex-col gap-3">
          {filterAndSortMessages(channelFlatMessages).map((msg, idx, arr) => {
            const msgDate = new Date(msg.createdAt).toDateString();
            const prevDate =
              idx > 0 ? new Date(arr[idx - 1].createdAt).toDateString() : null;
            const showDateDivider = idx === 0 || msgDate !== prevDate;

            return (
              <div key={msg.id}>
                {showDateDivider && (
                  <div className="flex items-center gap-3 py-2 mb-1">
                    <div className="flex-1 border-t" />
                    <span className="text-[10px] text-muted-foreground/50 font-medium">
                      {new Date(msg.createdAt).toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <div className="flex-1 border-t" />
                  </div>
                )}
                {conversationBoundaries.has(msg.id) && (
                  <div className="flex items-center gap-3 py-3 mb-3">
                    <div className="flex-1 border-t border-dashed" />
                    <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                      New conversation
                    </span>
                    <div className="flex-1 border-t border-dashed" />
                  </div>
                )}
                <BlockMessageItem
                  message={msg}
                  senderMap={senderMap}
                  currentUserId={currentUserId}
                  channelType={filteredConversations[0]?.channelType ?? 'web'}
                  onRetry={(messageId) => {
                    onRetry(
                      (msg as MessageRow & { _conversationId: string })
                        ._conversationId,
                      messageId,
                    );
                  }}
                />
              </div>
            );
          })}

          {contactLoading && (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          )}
        </div>
      </div>

      {/* Reply input */}
      <div className="border-t px-4 py-2 bg-background">
        {activeChannelConversation ? (
          <BlockReplyInput
            channelType={activeChannelConversation.channelType}
            onSend={(content, isInternal) =>
              onReply(activeChannelConversation.id, content, isInternal)
            }
            isPending={replyPending}
            error={replyError ? 'Failed to send reply' : null}
          />
        ) : selectedChannel ? (
          <>
            <p className="text-xs text-muted-foreground italic mb-1.5">
              No active conversation — sending will start a new one.
            </p>
            <BlockReplyInput
              channelType={selectedChannel.type}
              onSend={(content, isInternal) =>
                onNewConversation(selectedTabChannelId, content, isInternal)
              }
              isPending={newConversationPending}
              error={
                newConversationError ? 'Failed to start conversation' : null
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
});
