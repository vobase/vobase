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
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChannelBadge, PriorityIcon } from '@/components/conversation-badges';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messagingClient } from '@/lib/api-client';
import { formatRelativeTimeShort } from '@/lib/format';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  channels: string[];
  status: string;
  assignee: string | null;
  onHold: boolean;
  priority: string | null;
  unreadCount: number;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  lastMessageType: string | null;
  labels: { id: string; title: string; color: string | null }[];
}

interface TabCounts {
  active: number;
  onHold: number;
  done: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function messagePreview(row: ContactRow): string | null {
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

async function fetchActive(): Promise<ContactRow[]> {
  const res = await messagingClient.conversations.active.$get({
    query: { limit: '50' },
  });
  if (!res.ok) throw new Error('Failed to fetch active contacts');
  return res.json() as unknown as Promise<ContactRow[]>;
}

async function fetchOnHold(): Promise<ContactRow[]> {
  const res = await messagingClient.conversations['on-hold'].$get({
    query: { limit: '50' },
  });
  if (!res.ok) throw new Error('Failed to fetch on-hold contacts');
  return res.json() as unknown as Promise<ContactRow[]>;
}

async function fetchDone(): Promise<ContactRow[]> {
  const res = await messagingClient.conversations.resolved.$get({
    query: { limit: '50' },
  });
  if (!res.ok) throw new Error('Failed to fetch resolved contacts');
  return res.json() as unknown as Promise<ContactRow[]>;
}

async function fetchCounts(): Promise<TabCounts> {
  const res = await messagingClient.conversations.counts.$get();
  if (!res.ok) throw new Error('Failed to fetch counts');
  return res.json() as unknown as Promise<TabCounts>;
}

// ─── Contact Row Component ──────────────────────────────────────────

function ContactRowItem({
  row,
  isFocused,
}: {
  row: ContactRow;
  isFocused?: boolean;
}) {
  const { contactId: selectedId } = useParams({ strict: false });
  const isSelected = row.id === selectedId;
  const preview = messagePreview(row);
  const timeRef = row.lastMessageAt;
  const displayName = row.name ?? row.phone ?? row.email ?? 'Unknown';

  return (
    <Link
      to="/messaging/inbox/$contactId"
      params={{ contactId: row.id }}
      className={cn(
        'group flex items-start gap-2.5 px-3 py-2.5 transition-colors relative border-l-2',
        isSelected
          ? 'bg-primary/10 border-primary'
          : isFocused
            ? 'bg-muted/60 border-transparent ring-1 ring-inset ring-primary/50'
            : 'border-transparent hover:bg-muted/50',
      )}
    >
      {/* Unread indicator */}
      {row.unreadCount > 0 && (
        <div className="absolute left-0.5 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-primary" />
      )}

      <div className="flex-1 min-w-0 space-y-0.5">
        {/* Row 1: Name + time */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'truncate text-sm',
                row.unreadCount > 0 ? 'font-semibold' : 'font-medium',
              )}
            >
              {displayName}
            </span>
            {row.priority && <PriorityIcon priority={row.priority} />}
            {row.assignee?.startsWith('agent:') && (
              <span className="shrink-0 text-[10px] font-bold text-blue-500">
                @
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {timeRef ? formatRelativeTimeShort(timeRef) : ''}
          </span>
        </div>

        {/* Row 2: Channel badges */}
        <div className="flex items-center gap-1.5">
          {row.channels.map((ch) => (
            <ChannelBadge key={ch} type={ch} variant="icon" />
          ))}
        </div>

        {/* Row 3: Preview + unread count */}
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground truncate flex-1">
            {preview ?? '\u00A0'}
          </p>
          {row.unreadCount > 0 && (
            <Badge
              variant="default"
              className="h-4 min-w-4 px-1 text-[10px] font-bold shrink-0"
            >
              {row.unreadCount > 99 ? '99+' : row.unreadCount}
            </Badge>
          )}
        </div>

        {/* Row 4: Labels */}
        {row.labels.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {row.labels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: label.color ?? '#888' }}
                />
                {label.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── List skeleton + empty ──────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-1 px-3 py-2">
      {Array.from({ length: 8 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
        <div key={i} className="flex items-start gap-2.5 py-2.5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// ─── Main layout ────────────────────────────────────────────────────

function InboxLayout() {
  const [tab, setTab] = useState<'active' | 'on-hold' | 'done'>('active');
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listPanelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { contactId } = useParams({ strict: false });
  const hasSelection = Boolean(contactId);

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

  const { data: activeData, isPending: activePending } = useQuery({
    queryKey: ['conversations-active'],
    queryFn: fetchActive,
    refetchInterval: 60000,
    enabled: tab === 'active',
  });
  const { data: onHoldData, isPending: onHoldPending } = useQuery({
    queryKey: ['conversations-on-hold'],
    queryFn: fetchOnHold,
    refetchInterval: 60000,
    enabled: tab === 'on-hold',
  });
  const { data: doneData, isPending: donePending } = useQuery({
    queryKey: ['conversations-resolved'],
    queryFn: fetchDone,
    refetchInterval: 60000,
    enabled: tab === 'done',
  });

  const rawRows =
    tab === 'active'
      ? (activeData ?? [])
      : tab === 'on-hold'
        ? (onHoldData ?? [])
        : (doneData ?? []);

  const isPending =
    tab === 'active'
      ? activePending
      : tab === 'on-hold'
        ? onHoldPending
        : donePending;

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rawRows;
    const q = search.toLowerCase();
    return rawRows.filter(
      (row) =>
        (row.name ?? '').toLowerCase().includes(q) ||
        (row.phone ?? '').toLowerCase().includes(q) ||
        (row.email ?? '').toLowerCase().includes(q) ||
        (messagePreview(row) ?? '').toLowerCase().includes(q),
    );
  }, [rawRows, search]);

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
            to: '/messaging/inbox/$contactId',
            params: { contactId: row.id },
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

  const emptyProps =
    tab === 'active'
      ? {
          icon: <BotIcon className="h-5 w-5 text-muted-foreground" />,
          title: search ? 'No results' : 'No active contacts',
          subtitle: search
            ? 'No contacts match your search'
            : 'No active conversations right now',
        }
      : tab === 'on-hold'
        ? {
            icon: <CheckCircleIcon className="h-5 w-5 text-muted-foreground" />,
            title: search ? 'No results' : 'Nothing on hold',
            subtitle: search
              ? 'No contacts match your search'
              : 'No contacts are currently on hold',
          }
        : {
            icon: <InboxIcon className="h-5 w-5 text-muted-foreground" />,
            title: search ? 'No results' : 'Nothing resolved yet',
            subtitle: search
              ? 'No contacts match your search'
              : 'Resolved contacts will appear here',
          };

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* List panel — 320px fixed */}
      <div
        ref={listPanelRef}
        className={cn(
          'w-80 shrink-0 border-r flex flex-col overflow-hidden',
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
              placeholder="Search contacts..."
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
              <TabsTrigger value="active" className="flex-1 text-sm gap-1.5">
                Active
                {counts?.active ? (
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-4 px-1 text-xs font-bold"
                  >
                    {counts.active > 99 ? '99+' : counts.active}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="on-hold" className="flex-1 text-sm gap-1.5">
                On Hold
                {counts?.onHold ? (
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-4 px-1 text-xs font-bold"
                  >
                    {counts.onHold > 99 ? '99+' : counts.onHold}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="done" className="flex-1 text-sm">
                Done
              </TabsTrigger>
            </TabsList>
          </div>

          {(['active', 'on-hold', 'done'] as const).map((v) => (
            <TabsContent
              key={v}
              value={v}
              className="min-h-0 flex-1 mt-0 pt-2 overflow-hidden"
            >
              <ScrollArea className="h-full">
                {isPending ? (
                  <ListSkeleton />
                ) : filteredRows.length === 0 ? (
                  <EmptyState {...emptyProps} />
                ) : (
                  <div className="divide-y divide-border/50">
                    {filteredRows.map((row, idx) => (
                      <ContactRowItem
                        key={row.id}
                        row={row}
                        isFocused={idx === focusedIndex}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Detail pane — flex-1 */}
      <div
        className={cn(
          'flex-1 min-w-0 overflow-hidden',
          !hasSelection ? 'hidden lg:flex lg:flex-col' : 'flex flex-col',
        )}
      >
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/inbox')({
  component: InboxLayout,
});
