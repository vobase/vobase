import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { formatDistanceToNowStrict } from 'date-fns';
import { Bot, Filter, Globe, Mail, MessageCircle, User } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  title: string | null;
  agentId: string | null;
  channel: string;
  status: string;
  handler: string;
  priority: string | null;
  contactId: string | null;
  assigneeId: string | null;
  teamId: string | null;
  inboxId: string | null;
  escalationReason: string | null;
  escalationSummary: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Inbox {
  id: string;
  name: string;
  channel: string;
}

// ─── Fetchers ────────────────────────────────────────────────────────

async function fetchConversations(
  params: Record<string, string>,
): Promise<Conversation[]> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(
    `/api/messaging/conversations${query ? `?${query}` : ''}`,
  );
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

async function fetchInboxes(): Promise<Inbox[]> {
  const res = await fetch('/api/messaging/inboxes');
  if (!res.ok) return [];
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────

type Tab = 'all' | 'mine' | 'unassigned' | 'pending';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-emerald-500',
  pending: 'bg-amber-500',
  resolved: 'bg-gray-400',
  snoozed: 'bg-blue-500',
  closed: 'bg-gray-300 dark:bg-gray-600',
};

const PRIORITY_LABELS: Record<string, { class: string; label: string }> = {
  medium: {
    class: 'text-amber-600 dark:text-amber-400',
    label: 'Medium',
  },
  high: {
    class: 'text-orange-600 dark:text-orange-400',
    label: 'High',
  },
  urgent: {
    class: 'text-red-600 dark:text-red-400',
    label: 'Urgent',
  },
};

const CHANNEL_ICONS: Record<string, typeof Globe> = {
  web: Globe,
  whatsapp: MessageCircle,
  email: Mail,
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true });
  } catch {
    return '';
  }
}

// ─── Filter Popover ─────────────────────────────────────────────────

function FilterPopover({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  inboxFilter,
  setInboxFilter,
  handlerFilter,
  setHandlerFilter,
  inboxes,
  activeTab,
}: {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  priorityFilter: string;
  setPriorityFilter: (v: string) => void;
  inboxFilter: string;
  setInboxFilter: (v: string) => void;
  handlerFilter: string;
  setHandlerFilter: (v: string) => void;
  inboxes: Inbox[];
  activeTab: Tab;
}) {
  const hasActiveFilters =
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    inboxFilter !== 'all' ||
    handlerFilter !== 'all';

  function clearAll() {
    setStatusFilter('all');
    setPriorityFilter('all');
    setInboxFilter('all');
    setHandlerFilter('all');
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7 shrink-0', hasActiveFilters && 'text-primary')}
        >
          <Filter className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Filters</p>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-xs"
                onClick={clearAll}
              >
                Clear all
              </Button>
            )}
          </div>

          {activeTab !== 'pending' && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Status</p>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="snoozed">Snoozed</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Priority</p>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {inboxes.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Inbox</p>
              <Select value={inboxFilter} onValueChange={setInboxFilter}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All inboxes</SelectItem>
                  {inboxes.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {inbox.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {activeTab !== 'unassigned' && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Handler</p>
              <Select value={handlerFilter} onValueChange={setHandlerFilter}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All handlers</SelectItem>
                  <SelectItem value="ai">AI</SelectItem>
                  <SelectItem value="human">Human</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Conversation Item ──────────────────────────────────────────────

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onAssign,
  currentUserId,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onAssign: () => void;
  currentUserId: string | null;
}) {
  const ChannelIcon = CHANNEL_ICONS[conversation.channel] ?? Globe;
  const priorityInfo = conversation.priority
    ? PRIORITY_LABELS[conversation.priority]
    : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: intentionally div not button — contains nested Button for "assign to me" action
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-accent/50 cursor-pointer',
        isActive && 'bg-accent',
      )}
    >
      {/* Status dot */}
      <span
        className={cn(
          'mt-1.5 size-2 rounded-full shrink-0',
          STATUS_COLORS[conversation.status] ?? 'bg-gray-400',
        )}
      />

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5">
          {/* Handler icon */}
          {conversation.handler === 'ai' ? (
            <Bot className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <User className="size-3 text-muted-foreground shrink-0" />
          )}
          {/* Title */}
          <span className="text-sm font-medium truncate">
            {conversation.title ?? `${conversation.channel} conversation`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Priority */}
          {priorityInfo && (
            <span className={cn('text-[10px] font-medium', priorityInfo.class)}>
              {priorityInfo.label}
            </span>
          )}

          {/* Channel icon */}
          <ChannelIcon className="size-3 text-muted-foreground" />

          {/* Last activity */}
          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
            {relativeTime(
              conversation.lastActivityAt ?? conversation.updatedAt,
            )}
          </span>
        </div>
      </div>

      {/* Assign to me */}
      {!conversation.assigneeId && currentUserId && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 mt-0.5"
          title="Assign to me"
          onClick={(e) => {
            e.stopPropagation();
            onAssign();
          }}
        >
          <User className="size-3" />
        </Button>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────

function ConversationsLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;

  const params = useParams({ strict: false }) as {
    conversationId?: string;
  };
  const hasDetailOpen = !!params.conversationId;

  // Tab + filters
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [inboxFilter, setInboxFilter] = useState<string>('all');
  const [handlerFilter, setHandlerFilter] = useState<string>('all');

  // Build query params based on tab + filters
  const queryParams: Record<string, string> = {};
  if (activeTab === 'mine' && currentUserId) {
    queryParams.assigneeId = currentUserId;
  }
  if (activeTab === 'unassigned') {
    queryParams.handler = 'unassigned';
  }
  if (activeTab === 'pending') {
    queryParams.status = 'pending';
  }
  if (statusFilter !== 'all' && activeTab !== 'pending') {
    queryParams.status = statusFilter;
  }
  if (priorityFilter !== 'all') {
    queryParams.priority = priorityFilter;
  }
  if (inboxFilter !== 'all') {
    queryParams.inboxId = inboxFilter;
  }
  if (handlerFilter !== 'all' && activeTab !== 'unassigned') {
    queryParams.handler = handlerFilter;
  }

  const { data: conversations = [] } = useQuery({
    queryKey: ['messaging-conversations', queryParams],
    queryFn: () => fetchConversations(queryParams),
  });

  const { data: inboxes = [] } = useQuery({
    queryKey: ['messaging-inboxes'],
    queryFn: fetchInboxes,
  });

  const assignMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await fetch(
        `/api/messaging/conversations/${conversationId}/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigneeId: currentUserId }),
        },
      );
      if (!res.ok) throw new Error('Failed to assign');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversations'],
      });
      toast.success('Conversation assigned to you');
    },
    onError: () => {
      toast.error('Failed to assign conversation');
    },
  });

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'mine', label: 'Mine' },
    { key: 'unassigned', label: 'Unassigned' },
    { key: 'pending', label: 'Pending' },
  ];

  const hasActiveFilters =
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    inboxFilter !== 'all' ||
    handlerFilter !== 'all';

  return (
    <div className="flex h-full">
      {/* ─── Conversation list panel (fixed width, always visible on lg+) ─── */}
      <div
        className={cn(
          'border-r flex flex-col bg-background',
          hasDetailOpen
            ? 'hidden lg:flex w-[340px] 2xl:w-[380px]'
            : 'flex-1 lg:w-[340px] 2xl:w-[380px] lg:flex-none',
        )}
      >
        {/* Header row: tabs + filter */}
        <div className="flex items-center border-b">
          <div className="flex flex-1 px-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-2.5 py-2 text-xs font-medium transition-colors',
                  activeTab === tab.key
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 pr-2">
            {hasActiveFilters && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[9px] font-medium"
              >
                Filtered
              </Badge>
            )}
            <FilterPopover
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              inboxFilter={inboxFilter}
              setInboxFilter={setInboxFilter}
              handlerFilter={handlerFilter}
              setHandlerFilter={setHandlerFilter}
              inboxes={inboxes}
              activeTab={activeTab}
            />
          </div>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          <div className="divide-y">
            {conversations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No conversations found
              </p>
            )}
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={params.conversationId === conv.id}
                onSelect={() =>
                  navigate({
                    to: '/messaging/conversations/$conversationId',
                    params: { conversationId: conv.id },
                  })
                }
                onAssign={() => assignMutation.mutate(conv.id)}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ─── Detail panel (outlet) ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/conversations')({
  component: ConversationsLayout,
});
