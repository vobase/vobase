import { activityDescription, activityIcon } from '@/lib/activity-helpers';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MessageRow } from './types';

interface ActivityMessageProps {
  message: MessageRow;
  className?: string;
}

export function ActivityMessage({ message, className }: ActivityMessageProps) {
  const eventType = (message.contentData as Record<string, unknown>)
    ?.eventType as string | undefined;
  const description = activityDescription({
    content: eventType ?? message.content,
    contentData: message.contentData,
  });
  const icon = activityIcon(eventType ?? message.content);

  return (
    <div className={cn('flex items-center justify-center py-0.5', className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{description}</span>
        <span className="text-muted-foreground/40">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}
