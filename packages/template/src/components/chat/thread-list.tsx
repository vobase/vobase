import { MessageSquare, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface Thread {
  id: string;
  title: string | null;
  agentId: string;
  createdAt: string;
}

interface ThreadListProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewChat: () => void;
  isCreating?: boolean;
  hasAssistants?: boolean;
}

export function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onNewChat,
  isCreating = false,
  hasAssistants = true,
}: ThreadListProps) {
  return (
    <>
      <div className="p-3">
        <Button
          className="w-full gap-2"
          size="sm"
          onClick={onNewChat}
          disabled={isCreating || !hasAssistants}
        >
          <Plus className="size-3.5" />
          {isCreating ? 'Creating…' : 'New chat'}
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {threads.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6 px-3">
              No conversations yet
            </p>
          )}
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelectThread(thread.id)}
              className={cn(
                'w-full text-left rounded-md px-3 py-2 text-sm transition-colors flex items-center gap-2',
                activeThreadId === thread.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <MessageSquare className="size-3.5 shrink-0 opacity-50" />
              <span className="truncate">{thread.title ?? 'New chat'}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}
