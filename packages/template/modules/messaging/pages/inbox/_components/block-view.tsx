import { CircleAlertIcon } from 'lucide-react';
import { memo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { ConversationBlock } from '../../conversations/_components/conversation-block';
import type {
  MessageRow,
  SenderInfo,
  TimelineConversationFull,
} from '../../conversations/_components/types';

interface BlockViewProps {
  sortedConversations: TimelineConversationFull[];
  allConversations: TimelineConversationFull[];
  messagesByConversation: Map<string, MessageRow[]>;
  senderMap: Map<string, SenderInfo>;
  expandedConversationIds: Set<string>;
  currentUserId?: string;
  agents: Array<{ id: string; name: string }>;
  contactLoading: boolean;
  onToggleBlock: (conversationId: string) => void;
  onUpdateConversation: (
    conversationId: string,
    body: {
      status?: 'resolved' | 'failed';
      priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
      assignee?: string | null;
      onHold?: boolean;
    },
  ) => void;
  onRetry: (conversationId: string, messageId: string) => void;
}

export const BlockView = memo(function BlockView({
  sortedConversations,
  allConversations,
  messagesByConversation,
  senderMap,
  expandedConversationIds,
  currentUserId,
  agents,
  contactLoading,
  onToggleBlock,
  onUpdateConversation,
  onRetry,
}: BlockViewProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4 flex flex-col gap-4">
        {sortedConversations.map((conv) => {
          const msgs = messagesByConversation.get(conv.id) ?? [];
          return (
            <div key={conv.id} id={`block-${conv.id}`} data-block-id={conv.id}>
              <ConversationBlock
                conversation={conv}
                messages={msgs}
                senderMap={senderMap}
                isExpanded={expandedConversationIds.has(conv.id)}
                currentUserId={currentUserId}
                agents={agents}
                onToggle={() => onToggleBlock(conv.id)}
                onUpdateConversation={(body) =>
                  onUpdateConversation(
                    conv.id,
                    body as {
                      status?: 'resolved' | 'failed';
                      priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
                      assignee?: string | null;
                      onHold?: boolean;
                    },
                  )
                }
                onRetryMessage={(messageId) => onRetry(conv.id, messageId)}
              />
            </div>
          );
        })}

        {contactLoading && (
          <div className="space-y-3 px-1">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        )}

        {allConversations.length > 0 &&
          allConversations.every((i) => i.status === 'failed') && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
              <CircleAlertIcon className="h-4 w-4 shrink-0" />
              All conversations for this contact have failed.
            </div>
          )}
      </div>
    </div>
  );
});
