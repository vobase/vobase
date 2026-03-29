import { useMemo } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { useReadTracking } from '@/hooks/use-read-tracking';
import { useSmartScroll } from '@/hooks/use-smart-scroll';
import { groupMessagesIntoTurns } from '@/lib/group-turns';
import {
  isInternalNote,
  type NormalizedMessage,
} from '@/lib/normalize-message';
import { cn } from '@/lib/utils';
import { InternalNote } from './internal-note';
import { KbCurationOverlay } from './kb-curation-overlay';
import { MessageFeedback, type MessageReactions } from './message-feedback';
import { MessagePartsRenderer } from './message-parts-renderer';
import { TurnGroup } from './turn-group';
import { TypingIndicator } from './typing-indicator';

interface ChatMessageListProps {
  messages: NormalizedMessage[];
  viewMode: 'public' | 'staff';
  conversationId: string;
  contactLabel?: string;
  /** Public chat: useChat status for typing indicator */
  chatStatus?: 'streaming' | 'submitted' | 'ready' | 'error';
  /** Staff: is KB curation active? */
  kbCurationActive?: boolean;
  /** Reactions per message: messageId -> { positive: Reactor[], negative: Reactor[] } */
  feedbackMap?: Map<string, MessageReactions>;
  /** Current user ID for highlighting own reactions */
  currentUserId?: string;
  /** Callback when user reacts to a message */
  onReact?: (messageId: string, rating: 'positive' | 'negative') => void;
  /** Card action handler for public chat */
  onAction?: (actionId: string, value?: string) => void;
  /** Read-only mode (hides non-card tool calls) */
  readOnly?: boolean;
  /** Hide typing events from this user (the current staff user) */
  excludeUserId?: string;
}

/**
 * Inner component that lives inside Conversation (StickToBottom context).
 * Must be a child of Conversation so useSmartScroll can access useStickToBottomContext.
 */
function ChatMessageListInner({
  messages,
  viewMode,
  conversationId,
  contactLabel,
  chatStatus,
  kbCurationActive,
  feedbackMap,
  currentUserId,
  onReact,
  onAction,
  readOnly,
  excludeUserId,
}: ChatMessageListProps) {
  const filteredMessages = useMemo(() => {
    if (viewMode === 'public') {
      return messages.filter((m) => !isInternalNote(m));
    }
    return messages;
  }, [messages, viewMode]);

  const turns = useMemo(
    () => groupMessagesIntoTurns(filteredMessages, contactLabel),
    [filteredMessages, contactLabel],
  );

  // Smart scroll: track new messages while user is scrolled up
  const { newMessageCount, resetNewMessages } = useSmartScroll(
    filteredMessages.length,
  );

  // Read tracking: observe message elements for staff view
  const { observeRef } = useReadTracking(conversationId, viewMode === 'staff');

  // Show "thinking" until the AI outputs visible text.
  const lastMsg = filteredMessages.at(-1);
  const isActivelyStreaming = chatStatus === 'streaming';
  const hasAssistantText =
    lastMsg?.role === 'assistant' &&
    lastMsg.parts.some((p) => p.type === 'text' && !!p.text?.trim());
  const isAiThinking =
    (chatStatus === 'submitted' || isActivelyStreaming) && !hasAssistantText;
  const streamingMessageId =
    isActivelyStreaming && lastMsg?.role === 'assistant' ? lastMsg.id : null;

  return (
    <>
      <ConversationContent
        className={cn(
          'gap-4 py-4',
          viewMode === 'staff' ? 'px-6' : 'mx-auto max-w-2xl px-4',
        )}
      >
        {turns.map((turn) => (
          <TurnGroup key={turn.id} turn={turn} viewMode={viewMode}>
            {turn.messages.map((msg) => {
              if (msg.parts.length === 0) return null;

              // Internal notes get special rendering
              if (isInternalNote(msg) && viewMode === 'staff') {
                return <InternalNote key={msg.id} message={msg} />;
              }

              const extractedText = msg.parts
                .filter((p) => p.type === 'text')
                .map((p) => p.text ?? '')
                .join('');

              return (
                <div
                  key={msg.id}
                  ref={viewMode === 'staff' ? observeRef(msg.id) : undefined}
                  className={cn(
                    'relative flex flex-col gap-1',
                    kbCurationActive && msg.role === 'assistant' && 'pl-8',
                  )}
                >
                  {kbCurationActive && msg.role === 'assistant' && (
                    <KbCurationOverlay
                      messageId={msg.id}
                      messageText={extractedText}
                    />
                  )}

                  {viewMode === 'staff' && msg.metadata.deliveryStatus && (
                    <span
                      className={cn(
                        'text-[10px] pl-[18px]',
                        msg.metadata.deliveryStatus === 'delivered' ||
                          msg.metadata.deliveryStatus === 'read'
                          ? 'text-green-600 dark:text-green-400'
                          : msg.metadata.deliveryStatus === 'failed'
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {msg.metadata.deliveryStatus}
                    </span>
                  )}

                  {viewMode === 'public' ? (
                    <Message from={msg.role}>
                      <MessageContent>
                        <MessagePartsRenderer
                          parts={msg.parts}
                          messageId={msg.id}
                          onAction={onAction}
                          readOnly={readOnly}
                          isStreaming={msg.id === streamingMessageId}
                        />
                      </MessageContent>
                    </Message>
                  ) : (
                    <div className="pl-[18px] prose-sm prose-neutral dark:prose-invert max-w-none [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_p]:text-sm [&_li]:text-sm [&_ol]:text-sm [&_ul]:text-sm">
                      <MessagePartsRenderer
                        parts={msg.parts}
                        messageId={msg.id}
                        readOnly={readOnly}
                      />
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <MessageFeedback
                      messageId={msg.id}
                      reactions={feedbackMap?.get(msg.id)}
                      currentUserId={currentUserId}
                      onReact={onReact}
                    />
                  )}
                </div>
              );
            })}
          </TurnGroup>
        ))}
        <TypingIndicator
          conversationId={conversationId}
          isAiThinking={isAiThinking}
          excludeUserId={excludeUserId}
        />
      </ConversationContent>
      <ConversationScrollButton
        newMessageCount={newMessageCount}
        onClick={() => resetNewMessages()}
      />
    </>
  );
}

/**
 * Unified message list for both chat surfaces.
 * viewMode gates:
 *   'public' — feedback buttons on assistant msgs, no internal notes, no KB curation
 *   'staff'  — internal notes visible, sender labels, KB curation, all feedback, delivery status
 */
export function ChatMessageList(props: ChatMessageListProps) {
  return (
    <Conversation className="h-full flex-1">
      <ChatMessageListInner {...props} />
    </Conversation>
  );
}
