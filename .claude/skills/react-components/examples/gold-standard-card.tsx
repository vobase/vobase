import type React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
// Note for Agent: The '@' alias refers to the target project's src directory.
// Ensure src/data/mockData.ts is created before generating this component.
import { cardData } from '../data/mockData';

/**
 * Gold Standard: ActivityCard
 * This file serves as the definitive reference for the agent.
 */
interface ActivityCardProps {
  readonly id: string;
  readonly username: string;
  readonly action: 'MERGED' | 'COMMIT';
  readonly timestamp: string;
  readonly avatarUrl: string;
  readonly repoName: string;
}

export const ActivityCard: React.FC<ActivityCardProps> = ({
  username,
  action,
  timestamp,
  avatarUrl,
  repoName,
}) => {
  const isMerged = action === 'MERGED';

  return (
    <div
      className={cn('rounded-md bg-card p-3', 'shadow-sm ring-1 ring-white/10')}
    >
      <div className="flex min-h-[56px] items-center justify-between gap-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <img
            src={avatarUrl}
            alt={`Avatar for ${username}`}
            className="h-10 w-10 shrink-0 rounded-full"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <a href="#" className="truncate text-sm font-semibold text-primary">
              {username}
            </a>

            <Badge
              variant={isMerged ? 'secondary' : 'default'}
              className="rounded-full text-xs"
            >
              {action}
            </Badge>

            <span className="text-sm text-muted-foreground">in</span>

            <a href="#" className="truncate text-sm text-primary">
              {repoName}
            </a>
          </div>
        </div>

        <span className="shrink-0 text-sm text-muted-foreground">
          {timestamp}
        </span>
      </div>
    </div>
  );
};

export default ActivityCard;
