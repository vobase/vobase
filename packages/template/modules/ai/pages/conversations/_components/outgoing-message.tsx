import { BotIcon, ShieldCheckIcon, UserIcon } from 'lucide-react';
import { memo } from 'react';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DeliveryStatus } from './delivery-status';
import { PrivateNoteWrapper } from './private-note-wrapper';
import type { MessageRow } from './types';

interface OutgoingMessageProps {
  message: MessageRow;
  onRetry?: (messageId: string) => void;
  className?: string;
}

export const OutgoingMessage = memo(function OutgoingMessage({
  message,
  onRetry,
  className,
}: OutgoingMessageProps) {
  const isAgent = message.senderType === 'agent';
  const isStaff = message.senderType === 'user';
  const isSystem = message.senderType === 'system';
  const isWithdrawn = message.withdrawn;
  const isPrivate = message.private;
  const isDraft = message.resolutionStatus === 'pending';

  const senderLabel = isAgent
    ? 'Agent'
    : isStaff
      ? 'Staff'
      : isSystem
        ? 'System'
        : 'Unknown';

  const SenderIcon = isAgent ? BotIcon : isStaff ? UserIcon : ShieldCheckIcon;

  // Extract interactive buttons from contentData if present
  const interactive = message.contentData?.interactive as
    | {
        type: string;
        body?: { text: string };
        action?: {
          buttons?: Array<{ reply: { id: string; title: string } }>;
        };
      }
    | undefined;
  const replyButtons = interactive?.action?.buttons;

  const content = (
    <MessageContent>
      {isWithdrawn ? (
        <span className="text-sm text-muted-foreground italic">
          Message withdrawn
        </span>
      ) : (
        <>
          <MessageResponse>
            {interactive?.body?.text ?? message.content}
          </MessageResponse>
          {replyButtons && replyButtons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {replyButtons.map((btn) => (
                <span
                  key={btn.reply.id}
                  className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {btn.reply.title}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </MessageContent>
  );

  return (
    <Message from="assistant" className={className}>
      <div className="flex items-end gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <SenderIcon className="size-3.5 text-primary" />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                'font-medium',
                isAgent ? 'text-primary' : 'text-foreground',
              )}
            >
              {senderLabel}
            </span>
            {isDraft && (
              <Badge
                variant="outline"
                className="h-4 px-1.5 text-[10px] font-medium text-amber-600 border-amber-300"
              >
                Draft
              </Badge>
            )}
            <span>{formatRelativeTime(message.createdAt)}</span>
            <DeliveryStatus
              status={message.status}
              failureReason={message.failureReason}
              onRetry={onRetry ? () => onRetry(message.id) : undefined}
            />
          </div>
          {isPrivate ? (
            <PrivateNoteWrapper>{content}</PrivateNoteWrapper>
          ) : (
            content
          )}
        </div>
      </div>
    </Message>
  );
});
