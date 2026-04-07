import { UserIcon } from 'lucide-react';
import { memo } from 'react';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MessageRow, SenderInfo } from './types';

interface IncomingMessageProps {
  message: MessageRow;
  sender?: SenderInfo;
  className?: string;
}

export const IncomingMessage = memo(function IncomingMessage({
  message,
  sender,
  className,
}: IncomingMessageProps) {
  const isWithdrawn = message.withdrawn;
  const name = sender?.name ?? 'Customer';

  return (
    <Message from="user" className={cn('items-end', className)}>
      <div className="flex items-end gap-2 justify-end">
        <div className="flex flex-col items-end gap-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{name}</span>
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
        <Avatar className="size-7">
          <AvatarImage src={sender?.image ?? undefined} alt={name} />
          <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
            {sender?.name ? (
              sender.name.charAt(0).toUpperCase()
            ) : (
              <UserIcon className="size-3.5" />
            )}
          </AvatarFallback>
        </Avatar>
      </div>
    </Message>
  );
});
