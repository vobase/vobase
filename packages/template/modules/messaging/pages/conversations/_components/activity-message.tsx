import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import {
  activityDescription,
  activityIcon,
  type ResolveParticipantName,
} from '@/lib/activity-helpers';
import { cn } from '@/lib/utils';
import type { MessageRow } from './types';

interface ActivityMessageProps {
  message: MessageRow;
  className?: string;
  resolveName?: ResolveParticipantName;
}

export function ActivityMessage({
  message,
  className,
  resolveName,
}: ActivityMessageProps) {
  const eventType = (message.contentData as Record<string, unknown>)
    ?.eventType as string | undefined;
  const description = activityDescription(
    {
      content: eventType ?? message.content,
      contentData: message.contentData,
    },
    resolveName,
  );
  const icon = activityIcon(eventType ?? message.content);

  return (
    <div className={cn('flex items-center justify-center py-0.5', className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{description}</span>
        <RelativeTimeCard date={message.createdAt} />
      </div>
    </div>
  );
}
