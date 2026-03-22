import { useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { useState } from 'react';

import { ThreadList } from '@/components/chat/thread-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Thread {
  id: string;
  title: string | null;
  agentId: string;
  channel: string;
  status: string;
  contactId: string | null;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
}

async function fetchThreads(): Promise<Thread[]> {
  const res = await fetch('/api/messaging/threads');
  if (!res.ok) throw new Error('Failed to fetch threads');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/messaging/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

function ThreadsLayout() {
  const navigate = useNavigate();
  const [channelFilter, setChannelFilter] = useState<string>('all');

  // Try to read $threadId from params — undefined when at /messaging/threads (index)
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeThreadId = params.threadId ?? null;

  const { data: allThreads = [] } = useQuery({
    queryKey: ['messaging-threads'],
    queryFn: fetchThreads,
  });
  const threads = allThreads.filter(
    (t) => channelFilter === 'all' || t.channel === channelFilter,
  );
  const { data: agents } = useQuery({
    queryKey: ['messaging-agents'],
    queryFn: fetchAgents,
  });
  const hasAgents = (agents?.length ?? 0) > 0;

  return (
    <div className="flex h-full">
      <div className="w-[280px] border-r flex flex-col">
        <div className="px-3 pt-3 pb-1">
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ThreadList
          threads={threads.map((t) => {
            const statusLabel =
              t.channel !== 'web'
                ? t.status === 'human'
                  ? '[Human] '
                  : t.status === 'paused'
                    ? '[Paused] '
                    : ''
                : '';
            const channelIcon =
              t.channel === 'whatsapp'
                ? 'WA: '
                : t.channel !== 'web'
                  ? `${t.channel}: `
                  : '';
            const fallbackTitle =
              t.channel !== 'web' ? `${t.channel} conversation` : 'Untitled';
            return {
              ...t,
              title: `${channelIcon}${statusLabel}${t.title ?? fallbackTitle}`,
            };
          })}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => {
            navigate({
              to: '/messaging/threads/$threadId',
              params: { threadId: id },
            });
          }}
          onNewChat={() => {
            navigate({ to: '/messaging/threads' });
          }}
          hasAssistants={hasAgents}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/threads')({
  component: ThreadsLayout,
});
