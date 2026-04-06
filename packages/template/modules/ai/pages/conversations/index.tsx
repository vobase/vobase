import { useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import {
  BotIcon,
  CheckCircleIcon,
  InboxIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ChannelBadge,
  ContactBadge,
  ModeBadge,
  PriorityIcon,
} from '@/components/conversation-badges';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConversationQuality } from '@/hooks/use-conversation-quality';
import { aiClient } from '@/lib/api-client';
import { formatRelativeTimeShort } from '@/lib/format';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  status: string;
  mode: string | null;
  priority: string | null;
  contactId: string | null;
  contactName: string | null;
  agentId: string | null;
  channelInstanceId: string;
  channelType: string | null;
  createdAt: string;
  updatedAt: string;
  hasPendingEscalation: boolean;
  waitingSince: string | null;
  unreadCount: number;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  lastMessageType: string | null;
  labels: { id: string; title: string; color: string | null }[];
}

interface TabCounts {
  attention: number;
  ai: number;
  done: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function signalPreview(row: ConversationRow): string | null {
  const { lastMessageContent, lastMessageType } = row;
  if (!lastMessageContent && !lastMessageType) return null;

  if (lastMessageType === 'activity') {
    switch (lastMessageContent) {
      case 'escalation.created':
        return 'Escalated — needs attention';
      case 'handler.changed':
        return 'Mode changed';
      case 'session.completed':
        return 'Conversation resolved';
      case 'session.failed':
        return 'Conversation failed';
      case 'guardrail.block':
        return 'Message blocked by guardrail';
      case 'message.delivery_failed':
        return 'Message delivery failed';
      default:
        return lastMessageContent
          ? lastMessageContent.replace(/\./g, ' ')
          : null;
    }
  }

  if (lastMessageContent) {
    const text = lastMessageContent;
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  return null;
}

// ─── Data fetchers ────────────────────────────────────────────────────

async function fetchAttention(): Promise<ConversationRow[]> {
  const res = await aiClient.conversations.attention.$get({
    query: { limit: '50' },
  });
  if (!res.ok) throw new Error('Failed to fetch attention conversations');
  return res.json() as Promise<ConversationRow[]>;
}

async function fetchAiActive(): Promise<ConversationRow[]> {
  const res = await aiClient.conversations['ai-active'].$get({
    query: { limit: '50' },
  });
  if (!res.ok) throw new Error('Failed to fetch AI active conversations');
  return res.json() as Promise<ConversationRow[]>;
}

async function fetchResolved(): Promise<ConversationRow[]> {
  const res = await aiClient.conversations.resolved.$get({
    query: { limit: '50' },
  });
  if (!res.ok) throw new Error('Failed to fetch resolved conversations');
  return res.json() as Promise<ConversationRow[]>;
}

async function fetchCounts(): Promise<TabCounts> {
  const res = await aiClient.conversations.counts.$get();
  if (!res.ok) throw new Error('Failed to fetch conversation counts');
  return res.json() as Promise<TabCounts>;
}

// ─── Conversation Row ────────────────────────────────────────────────

function InboxRow({
  row,
  showMode,
  isFocused,
  quality,
}: {
  row: ConversationRow;
  showMode?: boolean;
  isFocused?: boolean;
  quality?: { avgScore: number; count: number };
}) {
  const { conversationId: selectedId } = useParams({ strict: false });
  const isSelected = row.id === selectedId;
  const preview = signalPreview(row);
  const timeRef = row.waitingSince ?? row.updatedAt;

  return (
    <Link
      to="/conversations/$conversationId"
      params={{ conversationId: row.id }}
      className={cn(
        'group flex items-start gap-2.5 px-3 py-2.5 transition-colors relative border-l-2',
        isSelected
          ? 'bg-primary/10 border-primary'
          : isFocused
            ? 'bg-muted/60 border-transparent ring-1 ring-inset ring-primary/50'
            : 'hover:bg-muted/40 border-transparent',
      )}
    >
      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <PriorityIcon priority={row.priority} />
          <ChannelBadge type={row.channelType} variant="icon" />
          <ContactBadge name={row.contactName} contactId={row.contactId} />
          {row.hasPendingEscalation && (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
          )}
          {quality && (
            <QualityBadge avgScore={quality.avgScore} count={quality.count} />
          )}
          {row.unreadCount > 0 && (
            <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground px-1">
              {row.unreadCount > 9 ? '9+' : row.unreadCount}
            </span>
          )}
        </div>
        {preview && (
          <p className="text-sm text-muted-foreground truncate mt-0.5 leading-relaxed">
            {preview}
          </p>
        )}
        {row.labels?.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            {row.labels.slice(0, 2).map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: label.color ?? '#6b7280' }}
                />
                {label.title}
              </span>
            ))}
            {row.labels.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{row.labels.length - 2}
              </span>
            )}
          </div>
        )}
        {showMode && row.mode && (
          <ModeBadge mode={row.mode} variant="muted" className="mt-0.5" />
        )}
      </div>

      {/* Time */}
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">
        {formatRelativeTimeShort(timeRef)}
      </span>
    </Link>
  );
}

function QualityBadge({
  avgScore,
  count,
}: {
  avgScore: number;
  count: number;
}) {
  const pct = Math.round(avgScore * 100);
  const color =
    avgScore >= 0.8
      ? 'bg-green-500'
      : avgScore >= 0.6
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <span
      title={`Quality: ${pct}% (${count} score${count !== 1 ? 's' : ''})`}
      className={cn('inline-flex h-1.5 w-1.5 rounded-full shrink-0', color)}
    />
  );
}

// ─── Skeleton Row ────────────────────────────────────────────────────

function InboxRowSkeleton() {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-3 w-8" />
    </div>
  );
}

// ─── Conversation List ────────────────────────────────────────────────

function ConversationList({
  rows,
  isPending,
  showMode,
  focusedIndex,
  qualityMap,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
}: {
  rows: ConversationRow[];
  isPending: boolean;
  showMode?: boolean;
  focusedIndex: number;
  qualityMap: Record<string, { avgScore: number; count: number }>;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptySubtitle: string;
}) {
  if (isPending) {
    return (
      <div className="space-y-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton array
          <InboxRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-3">
          {emptyIcon}
        </div>
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="text-sm text-muted-foreground mt-1">{emptySubtitle}</p>
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {rows.map((row, i) => (
        <InboxRow
          key={row.id}
          row={row}
          showMode={showMode}
          isFocused={i === focusedIndex}
          quality={qualityMap[row.id]}
        />
      ))}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────

function NoConversationSelected() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <SparklesIcon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        No conversation selected
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Select a conversation from the list to view it
      </p>
    </div>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────

function ConversationsLayout() {
  const { conversationId } = useParams({ strict: false });
  const hasSelection = !!conversationId;
  const navigate = useNavigate();

  const [tab, setTab] = useState<'attention' | 'ai' | 'done'>('attention');
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listPanelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // When navigating directly to a conversation, auto-select the correct tab
  const tabInitRef = useRef(false);
  useEffect(() => {
    if (!conversationId || tabInitRef.current) return;
    tabInitRef.current = true;
    aiClient.conversations[':id']
      .$get({ param: { id: conversationId } })
      .then(async (res) => {
        if (!res.ok) return;
        const conv = (await res.json()) as {
          status: string;
          mode: string | null;
        };
        if (conv.status === 'completed' || conv.status === 'failed') {
          setTab('done');
        } else if (conv.mode === 'ai') {
          setTab('ai');
        }
        // else default 'attention' is correct for human/supervised/held
      })
      .catch(() => {});
  }, [conversationId]);

  // Reset search + focus when tab changes
  const handleTabChange = useCallback((v: string) => {
    setTab(v as typeof tab);
    setSearch('');
    setFocusedIndex(-1);
  }, []);

  const { data: counts } = useQuery({
    queryKey: ['conversations-counts'],
    queryFn: fetchCounts,
    refetchInterval: 60000,
  });

  // Fetch active tab data
  const { data: attentionData, isPending: attentionPending } = useQuery({
    queryKey: ['conversations-attention'],
    queryFn: fetchAttention,
    refetchInterval: 60000,
    enabled: tab === 'attention',
  });
  const { data: aiData, isPending: aiPending } = useQuery({
    queryKey: ['conversations-ai-active'],
    queryFn: fetchAiActive,
    refetchInterval: 60000,
    enabled: tab === 'ai',
  });
  const { data: resolvedData, isPending: resolvedPending } = useQuery({
    queryKey: ['conversations-resolved'],
    queryFn: fetchResolved,
    refetchInterval: 60000,
    enabled: tab === 'done',
  });

  const rawRows =
    tab === 'attention'
      ? (attentionData ?? [])
      : tab === 'ai'
        ? (aiData ?? [])
        : (resolvedData ?? []);

  const isPending =
    tab === 'attention'
      ? attentionPending
      : tab === 'ai'
        ? aiPending
        : resolvedPending;

  // Client-side filter by contact name and signal preview
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rawRows;
    const q = search.toLowerCase();
    return rawRows.filter(
      (row) =>
        (row.contactName ?? '').toLowerCase().includes(q) ||
        (row.contactId ?? '').toLowerCase().includes(q) ||
        (signalPreview(row) ?? '').toLowerCase().includes(q),
    );
  }, [rawRows, search]);

  // Keyboard navigation via document listener (J/K/Enter/Escape//)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inSearch = document.activeElement === searchInputRef.current;

      if (inSearch) {
        if (e.key === 'Escape') {
          setSearch('');
          setFocusedIndex(-1);
        }
        return;
      }

      // Only intercept when focus is inside the list panel or unowned
      const panelEl = listPanelRef.current;
      if (
        panelEl &&
        !panelEl.contains(document.activeElement) &&
        document.activeElement !== document.body
      ) {
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, filteredRows.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault();
        const row = filteredRows[focusedIndex];
        if (row) {
          navigate({
            to: '/conversations/$conversationId',
            params: { conversationId: row.id },
          });
        }
      } else if (e.key === 'Escape') {
        setFocusedIndex(-1);
      } else if (e.key === '/' || e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [filteredRows, focusedIndex, navigate]);

  const qualityMap = useConversationQuality(filteredRows.map((r) => r.id));

  const showMode = tab === 'attention';

  const emptyProps =
    tab === 'attention'
      ? {
          emptyIcon: (
            <CheckCircleIcon className="h-5 w-5 text-muted-foreground" />
          ),
          emptyTitle: search ? 'No results' : 'All clear',
          emptySubtitle: search
            ? 'No conversations match your search'
            : 'No conversations need attention',
        }
      : tab === 'ai'
        ? {
            emptyIcon: <BotIcon className="h-5 w-5 text-muted-foreground" />,
            emptyTitle: search ? 'No results' : 'No active conversations',
            emptySubtitle: search
              ? 'No conversations match your search'
              : 'AI is not handling any conversations right now',
          }
        : {
            emptyIcon: <InboxIcon className="h-5 w-5 text-muted-foreground" />,
            emptyTitle: search ? 'No results' : 'Nothing resolved yet',
            emptySubtitle: search
              ? 'No conversations match your search'
              : 'Resolved conversations will appear here',
          };

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* List panel — 320px fixed */}
      <div
        ref={listPanelRef}
        className={cn(
          'w-80 shrink-0 border-r flex flex-col overflow-hidden',
          // Below 1024px: hide list when detail is active
          hasSelection ? 'hidden lg:flex' : 'flex',
        )}
      >
        {/* Search */}
        <div className="px-3 pt-3 shrink-0">
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setFocusedIndex(-1);
              }}
              placeholder="Search conversations…"
              className="w-full rounded-md border border-input bg-transparent py-1.5 pl-8 pr-7 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  listPanelRef.current?.focus();
                }}
                className="absolute right-2 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={handleTabChange}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="px-3 pt-2 shrink-0">
            <TabsList className="w-full">
              <TabsTrigger value="attention" className="flex-1 text-sm gap-1.5">
                Attention
                {counts?.attention ? (
                  <Badge
                    variant="destructive"
                    className="h-4 min-w-4 px-1 text-xs font-bold"
                  >
                    {counts.attention > 99 ? '99+' : counts.attention}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex-1 text-sm gap-1.5">
                AI
                {counts?.ai ? (
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-4 px-1 text-xs font-bold"
                  >
                    {counts.ai > 99 ? '99+' : counts.ai}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="done" className="flex-1 text-sm">
                Done
              </TabsTrigger>
            </TabsList>
          </div>

          {(['attention', 'ai', 'done'] as const).map((v) => (
            <TabsContent
              key={v}
              value={v}
              className="min-h-0 flex-1 mt-0 pt-2 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <ConversationList
                  rows={filteredRows}
                  isPending={isPending}
                  showMode={showMode}
                  focusedIndex={focusedIndex}
                  qualityMap={qualityMap}
                  {...emptyProps}
                />
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Detail pane — flex-1 */}
      <div
        className={cn(
          'flex-1 min-w-0 overflow-hidden',
          // Below 1024px: hide outlet when no selection
          !hasSelection ? 'hidden lg:flex lg:flex-col' : 'flex flex-col',
        )}
      >
        {hasSelection ? <Outlet /> : <NoConversationSelected />}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations')({
  component: ConversationsLayout,
});
