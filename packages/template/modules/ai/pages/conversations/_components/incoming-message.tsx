import { UserIcon } from 'lucide-react';
import { memo } from 'react';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MessageRow } from './types';

interface IncomingMessageProps {
  message: MessageRow;
  contactName?: string;
  className?: string;
}

export const IncomingMessage = memo(function IncomingMessage({
  message,
  contactName,
  className,
}: IncomingMessageProps) {
  const isWithdrawn = message.withdrawn;

  return (
    <Message from="user" className={cn('items-end', className)}>
      <div className="flex items-end gap-2 justify-end">
        <div className="flex flex-col items-end gap-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {contactName ?? 'Customer'}
            </span>
            <span>{formatRelativeTime(message.createdAt)}</span>
          </div>
          <MessageContent className={cn(isWithdrawn && 'opacity-50 italic')}>
            {isWithdrawn ? (
              <span className="text-sm text-muted-foreground italic">
                Message withdrawn
              </span>
            ) : (
              <MessageResponse>{message.content}</MessageResponse>
            )}
          </MessageContent>
        </div>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <UserIcon className="size-3.5 text-muted-foreground" />
        </div>
      </div>
    </Message>
  );
});
