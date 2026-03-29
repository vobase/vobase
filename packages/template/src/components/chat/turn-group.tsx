import { BotIcon, UserIcon } from 'lucide-react';

import type { Turn } from '@/lib/group-turns';
import { cn } from '@/lib/utils';

interface TurnGroupProps {
  turn: Turn;
  viewMode: 'public' | 'staff';
  children: React.ReactNode;
}

function SenderIcon({ label }: { label: string }) {
  if (label.startsWith('Staff')) {
    return <UserIcon className="h-3 w-3 text-blue-500" />;
  }
  if (label === 'AI Agent') {
    return <BotIcon className="h-3 w-3 text-muted-foreground" />;
  }
  return <UserIcon className="h-3 w-3 text-muted-foreground" />;
}

/**
 * Visual wrapper grouping messages into a logical turn.
 * Staff view shows sender labels + timestamps; public view is transparent.
 */
export function TurnGroup({ turn, viewMode, children }: TurnGroupProps) {
  const showHeader = viewMode === 'staff' && turn.senderLabel;

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        turn.role === 'user' && viewMode === 'staff'
          ? 'bg-muted/40 rounded-lg px-3 py-2 border border-border/30'
          : '',
      )}
    >
      {showHeader && (
        <div className="flex items-center gap-1.5 mb-1">
          <SenderIcon label={turn.senderLabel ?? ''} />
          <span
            className={cn(
              'text-[10px] font-medium',
              turn.role === 'user'
                ? 'text-foreground'
                : turn.senderLabel?.startsWith('Staff')
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-muted-foreground',
            )}
          >
            {turn.senderLabel}
          </span>
          {turn.timestamp && (
            <span className="text-[10px] text-muted-foreground/60">
              {new Date(turn.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
