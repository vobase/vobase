import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  PanelRightIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AssigneeBadge, ChannelBadge } from '@/components/conversation-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { isTimelineVisibleEvent } from '@/lib/activity-helpers';
import { agentsClient, messagingClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { formatRelativeTime } from '@/lib/format';
import { extractStaffName } from '@/lib/normalize-message';
import { useInboxDetailStore } from '@/stores/inbox-detail-store';
import { BlockReplyInput } from '../conversations/_components/block-reply-input';
import {
  BlockMessageItem,
  ConversationBlock,
} from '../conversations/_components/conversation-block';
import type {
  MessageRow,
  SenderInfo,
  TimelineConversationFull,
} from '../conversations/_components/types';

// ─── Types ────────────────────────────────────────────────────────────

interface TimelinePage {
  messages: MessageRow[];
  hasMore: boolean;
  nextCursor?: string | null;
  conversations: TimelineConversationFull[];
  channels: { id: string; type: string; label: string | null }[];
}

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
}

interface ContactLabel {
  id: string;
  title: string;
  color: string | null;
  description: string | null;
  assignedAt: string;
}

interface AgentInfo {
  id: string;
  name: string;
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await messagingClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) throw new Error('Contact not found');
  return res.json() as Promise<Contact>;
}

async function fetchTimelinePage(
  contactId: string,
  before?: string,
): Promise<TimelinePage> {
  const query: { limit: string; before?: string } = { limit: '50' };
  if (before) query.before = before;
  const res = await messagingClient.contacts[':id'].timeline.$get({
    param: { id: contactId },
    query,
  });
  if (!res.ok)
    return { messages: [], hasMore: false, conversations: [], channels: [] };
  const data = await res.json();
  return data as unknown as TimelinePage;
}

async function markContactRead(contactId: string): Promise<void> {
  await messagingClient.contacts[':id']['mark-read'].$post({
    param: { id: contactId },
  });
}

async function fetchContactLabels(contactId: string): Promise<ContactLabel[]> {
  const res = await messagingClient.contacts[':id'].labels.$get({
    param: { id: contactId },
  });
  if (!res.ok) return [];
  return res.json() as Promise<ContactLabel[]>;
}

async function fetchAllLabels(): Promise<
  { id: string; title: string; color: string | null }[]
> {
  const res = await messagingClient.labels.$get();
  if (!res.ok) return [];
  return res.json() as Promise<
    { id: string; title: string; color: string | null }[]
  >;
}

async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await agentsClient.agents.$get();
  if (!res.ok) return [];
  return res.json() as Promise<AgentInfo[]>;
}

async function sendReply(
  conversationId: string,
  content: string,
  isInternal = false,
): Promise<unknown> {
  const res = await messagingClient.conversations[':id'].reply.$post(
    { param: { id: conversationId } },
    {
      init: {
        body: JSON.stringify({ content, isInternal }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to send reply');
  return res.json();
}

async function createNewConversation(
  contactId: string,
  channelInstanceId: string,
  content: string,
  isInternal: boolean,
): Promise<{ conversationId: string; messageId: string }> {
  const res = await messagingClient.contacts[':id']['new-conversation'].$post(
    { param: { id: contactId } },
    {
      init: {
        body: JSON.stringify({ channelInstanceId, content, isInternal }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json() as Promise<{
    conversationId: string;
    messageId: string;
  }>;
}

async function updateConversation(
  id: string,
  body: {
    status?: 'resolved' | 'failed';
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
    assignee?: string | null;
    onHold?: boolean;
  },
): Promise<unknown> {
  const res = await messagingClient.conversations[':id'].$patch(
    { param: { id } },
    {
      init: {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to update conversation');
  return res.json();
}

// ─── Sidebar Row ─────────────────────────────────────────────────────

function SidebarRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-2 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground truncate text-right">
        {children}
      </span>
    </div>
  );
}

// ─── Contact Labels Manager ─────────────────────────────────────────

function ContactLabelsSection({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const { data: contactLabels = [] } = useQuery({
    queryKey: ['contact-labels', contactId],
    queryFn: () => fetchContactLabels(contactId),
  });

  const { data: allLabels = [] } = useQuery({
    queryKey: ['labels'],
    queryFn: fetchAllLabels,
    staleTime: 60000,
  });

  const addMutation = useMutation({
    mutationFn: (labelIds: string[]) =>
      messagingClient.contacts[':id'].labels.$post(
        { param: { id: contactId } },
        {
          init: {
            body: JSON.stringify({ labelIds }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['contact-labels', contactId],
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (labelId: string) =>
      messagingClient.contacts[':id'].labels[':labelId'].$delete({
        param: { id: contactId, labelId },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['contact-labels', contactId],
      }),
  });

  const assignedIds = new Set(contactLabels.map((l) => l.id));
  const available = allLabels.filter((l) => !assignedIds.has(l.id));

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Labels
      </p>
      <div className="space-y-1.5">
        {contactLabels.map((label) => (
          <div
            key={label.id}
            className="flex items-center justify-between gap-2 group"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: label.color ?? '#888' }}
              />
              <span className="text-sm">{label.title}</span>
            </div>
            <button
              type="button"
              onClick={() => removeMutation.mutate(label.id)}
              className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <XCircleIcon className="h-3 w-3" />
            </button>
          </div>
        ))}
        {available.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <PlusIcon className="h-3 w-3" />
                Add label
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {available.map((label) => (
                <DropdownMenuItem
                  key={label.id}
                  onClick={() => addMutation.mutate([label.id])}
                  className="gap-2 text-sm"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color ?? '#888' }}
                  />
                  {label.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function InboxDetailPage() {
  const { contactId } = Route.useParams() as { contactId: string };
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('inbox-sidebar') === 'open',
  );
  useEffect(() => {
    localStorage.setItem('inbox-sidebar', sidebarOpen ? 'open' : 'closed');
  }, [sidebarOpen]);

  // ── Zustand store ──────────────────────────────────────────────────
  const store = useInboxDetailStore();
  const {
    expandedConversationIds,
    selectedTabChannelId,
    toggleBlock,
    setDefaultExpansion,
    selectTabChannel,
  } = store;

  // Switch contact atomically when URL changes
  useEffect(() => {
    if (store.contactId !== contactId) {
      store.switchContact(contactId);
    }
  }, [contactId, store]);

  // ── Queries ────────────────────────────────────────────────────────
  const {
    data: contact,
    isLoading: contactLoading,
    isError: contactError,
  } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => fetchContact(contactId),
  });

  const { data: timelineData, hasNextPage } = useInfiniteQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchTimelinePage(contactId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (firstPage) => firstPage.nextCursor ?? undefined,
    enabled: !!contact,
    placeholderData: keepPreviousData,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // ── Derived data ───────────────────────────────────────────────────
  const allMessages = useMemo(
    () => timelineData?.pages.flatMap((p) => p.messages) ?? [],
    [timelineData],
  );

  const allConversations = useMemo(
    () => timelineData?.pages[0]?.conversations ?? [],
    [timelineData],
  );

  const channels = useMemo(
    () => timelineData?.pages[0]?.channels ?? [],
    [timelineData],
  );

  // Auto-select first channel tab when channels load (sorted by most recent activity)
  const autoSelectedTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (channels.length > 0 && autoSelectedTabRef.current !== contactId) {
      autoSelectedTabRef.current = contactId;
      // Sort channels by most recent conversation activity
      const channelActivity = new Map<string, number>();
      for (const conv of allConversations) {
        const t = new Date(conv.startedAt).getTime();
        const current = channelActivity.get(conv.channelInstanceId) ?? 0;
        if (t > current) channelActivity.set(conv.channelInstanceId, t);
      }
      const sorted = [...channels].sort(
        (a, b) =>
          (channelActivity.get(b.id) ?? 0) - (channelActivity.get(a.id) ?? 0),
      );
      selectTabChannel(sorted[0]?.id ?? null);
    }
  }, [channels, contactId, allConversations, selectTabChannel]);

  // Chronological sort for threads view
  const sortedConversations = useMemo(
    () =>
      [...allConversations].sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [allConversations],
  );

  // Filter conversations by selected channel tab (null = "All")
  const filteredConversations = useMemo(() => {
    if (!selectedTabChannelId) return sortedConversations;
    return sortedConversations.filter(
      (i) => i.channelInstanceId === selectedTabChannelId,
    );
  }, [sortedConversations, selectedTabChannelId]);

  // Group messages by conversationId for per-block rendering
  const messagesByConversation = useMemo(() => {
    const map = new Map<string, MessageRow[]>();
    for (const msg of allMessages) {
      const list = map.get(msg.conversationId) ?? [];
      list.push(msg);
      map.set(msg.conversationId, list);
    }
    return map;
  }, [allMessages]);

  // Active conversation for the selected channel tab (at most one per channel instance)
  const activeChannelConversation = useMemo(() => {
    if (!selectedTabChannelId) return null;
    return (
      filteredConversations.find(
        (i) => i.status === 'active' || i.status === 'resolving',
      ) ?? null
    );
  }, [filteredConversations, selectedTabChannelId]);

  // Flat message list for channel tab view — all messages across conversations, chronological,
  // with conversation boundary info attached
  const channelFlatMessages = useMemo(() => {
    if (!selectedTabChannelId) return [];
    const msgs: Array<MessageRow & { _conversationId: string }> = [];
    for (const conv of filteredConversations) {
      const conversationMsgs = messagesByConversation.get(conv.id) ?? [];
      for (const msg of conversationMsgs) {
        msgs.push({ ...msg, _conversationId: conv.id });
      }
    }
    return msgs.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [selectedTabChannelId, filteredConversations, messagesByConversation]);

  // Compute conversation boundary positions for dividers
  const conversationBoundaries = useMemo(() => {
    const boundaries = new Set<string>();
    let lastConversationId: string | null = null;
    for (const msg of channelFlatMessages) {
      if (lastConversationId && msg._conversationId !== lastConversationId) {
        boundaries.add(msg.id); // This message starts a new conversation
      }
      lastConversationId = msg._conversationId;
    }
    return boundaries;
  }, [channelFlatMessages]);

  // Selected channel for new-message flow (derived from tab selection)
  const selectedChannel = useMemo(
    () =>
      channels.find((c) => c.id === selectedTabChannelId) ??
      channels[0] ??
      null,
    [channels, selectedTabChannelId],
  );

  // ── Scroll to bottom on channel tab switch ─────────────────────────
  const channelScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (channelScrollRef.current && selectedTabChannelId) {
      channelScrollRef.current.scrollTop =
        channelScrollRef.current.scrollHeight;
    }
  }, [selectedTabChannelId, channelFlatMessages.length]);

  // ── Effects ────────────────────────────────────────────────────────

  // Set default expansion once per contact when conversations first load
  const defaultExpansionContactRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      allConversations.length > 0 &&
      defaultExpansionContactRef.current !== contactId
    ) {
      defaultExpansionContactRef.current = contactId;
      setDefaultExpansion(allConversations);
    }
  }, [allConversations, contactId, setDefaultExpansion]);

  // Scroll to first active block on initial load (threads view)
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (hasScrolledRef.current || sortedConversations.length === 0) return;
    hasScrolledRef.current = true;
    const firstActive = sortedConversations.find((i) => i.status === 'active');
    if (!firstActive) return;
    const el = document.getElementById(`block-${firstActive.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sortedConversations]);

  // Mark contact as read
  const lastMsgId = allMessages[allMessages.length - 1]?.id;
  const hasMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastMsgId || hasMarkedRef.current === lastMsgId) return;
    hasMarkedRef.current = lastMsgId;
    markContactRead(contactId).catch(() => {});
  }, [contactId, lastMsgId]);

  // ── Sender map ─────────────────────────────────────────────────────
  const senderMap = useMemo(() => {
    const map = new Map<string, SenderInfo>();
    if (session?.user) {
      map.set(session.user.id, {
        name: session.user.name ?? session.user.email,
        image: session.user.image,
      });
    }
    if (contact) {
      map.set(contactId, {
        name: contact.name ?? contact.phone ?? 'Customer',
      });
    }
    for (const agent of agents) {
      map.set(agent.id, { name: agent.name });
    }
    for (const msg of allMessages) {
      if (msg.senderType === 'user' && !map.has(msg.senderId)) {
        const name = extractStaffName(msg.content);
        if (name) map.set(msg.senderId, { name });
      }
    }
    return map;
  }, [session, contact, contactId, agents, allMessages]);

  // ── Sidebar visible block tracking ────────────────────────────────
  const [visibleBlockId, setVisibleBlockId] = useState<string | null>(null);
  useEffect(() => {
    if (sortedConversations.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-block-id');
            if (id) setVisibleBlockId(id);
          }
        }
      },
      { threshold: 0.3 },
    );
    for (const conv of sortedConversations) {
      const el = document.getElementById(`block-${conv.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sortedConversations]);

  const scrollToBlock = useCallback((conversationId: string) => {
    document
      .getElementById(`block-${conversationId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['contact-timeline', contactId],
    });
    queryClient.invalidateQueries({ queryKey: ['conversations-attention'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-active'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-resolved'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-counts'] });
  }, [queryClient, contactId]);

  const updateConversationMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof updateConversation>[1];
    }) => updateConversation(id, body),
    onSuccess: invalidateAll,
  });

  const replyMutation = useMutation({
    mutationFn: ({
      conversationId,
      content,
      isInternal,
    }: {
      conversationId: string;
      content: string;
      isInternal: boolean;
      replyToMessageId?: string;
    }) => sendReply(conversationId, content, isInternal),
    onSuccess: invalidateAll,
  });

  const retryMutation = useMutation({
    mutationFn: ({
      conversationId,
      messageId,
    }: {
      conversationId: string;
      messageId: string;
    }) =>
      messagingClient.conversations[':id'].messages[':mid'].retry.$post({
        param: { id: conversationId, mid: messageId },
      }),
    onSuccess: invalidateAll,
  });

  const newConversationMutation = useMutation({
    mutationFn: ({
      channelInstanceId,
      content,
      isInternal,
    }: {
      channelInstanceId: string;
      content: string;
      isInternal: boolean;
    }) =>
      createNewConversation(contactId, channelInstanceId, content, isInternal),
    onSuccess: invalidateAll,
  });

  // Hard error
  if (contactError && !contact) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Contact not found</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Main panel ─── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Contact header */}
        <div className="border-b bg-background px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {contact ? (
                <>
                  <h1 className="text-base font-semibold truncate">
                    {contact.name ??
                      contact.phone ??
                      contact.email ??
                      'Unknown'}
                  </h1>
                  {contact.phone && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {contact.phone}
                    </span>
                  )}
                  {contact.email && !contact.phone && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {contact.email}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Skeleton className="h-[1.5rem] w-32 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {contact && (
                <Link
                  to="/messaging/contacts/$contactId"
                  params={{ contactId: contact.id }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Profile
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* ─── Channel tabs ─── */}
        {channels.length > 1 && (
          <div className="border-b bg-background px-4">
            <div className="flex items-center gap-0.5 -mb-px">
              {channels
                .slice()
                .sort((a, b) => {
                  const aTime = Math.max(
                    ...allConversations
                      .filter((i) => i.channelInstanceId === a.id)
                      .map((i) => new Date(i.startedAt).getTime()),
                    0,
                  );
                  const bTime = Math.max(
                    ...allConversations
                      .filter((i) => i.channelInstanceId === b.id)
                      .map((i) => new Date(i.startedAt).getTime()),
                    0,
                  );
                  return bTime - aTime;
                })
                .map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => selectTabChannel(ch.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      selectedTabChannelId === ch.id
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                    }`}
                  >
                    <ChannelBadge type={ch.type} variant="icon" />
                    {ch.label ?? ch.type}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => selectTabChannel(null)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  selectedTabChannelId === null
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                }`}
              >
                All
              </button>
            </div>
          </div>
        )}

        {/* ─── Content area ─── */}
        {selectedTabChannelId ? (
          /* ── Channel tab: flat message timeline ── */
          <div className="flex flex-1 flex-col min-h-0">
            {/* Conversation action bar — always visible on channel tabs, disabled when no active conversation */}
            {selectedTabChannelId && (
              <div
                className={`flex items-center gap-2 border-b px-4 py-1.5 bg-muted/20 ${!activeChannelConversation ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <AssigneeBadge
                  assignee={activeChannelConversation?.assignee ?? null}
                  variant="field"
                  onSelect={(v) =>
                    activeChannelConversation &&
                    updateConversationMutation.mutate({
                      id: activeChannelConversation.id,
                      body: { assignee: v },
                    })
                  }
                  agents={agents}
                />
                <div className="flex-1" />
                <Button
                  variant={
                    activeChannelConversation?.onHold ? 'secondary' : 'ghost'
                  }
                  size="sm"
                  disabled={!activeChannelConversation}
                  className={`h-7 gap-1.5 text-xs ${activeChannelConversation?.onHold ? 'text-amber-600 dark:text-amber-400' : ''}`}
                  onClick={() =>
                    activeChannelConversation &&
                    updateConversationMutation.mutate({
                      id: activeChannelConversation.id,
                      body: { onHold: !activeChannelConversation.onHold },
                    })
                  }
                >
                  {activeChannelConversation?.onHold ? (
                    <>
                      <PlayIcon className="h-3 w-3" />
                      Resume
                    </>
                  ) : (
                    <>
                      <PauseIcon className="h-3 w-3" />
                      Hold
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!activeChannelConversation}
                  className="h-7 gap-1.5 text-xs"
                  onClick={() =>
                    activeChannelConversation &&
                    updateConversationMutation.mutate({
                      id: activeChannelConversation.id,
                      body: { status: 'resolved' },
                    })
                  }
                >
                  <CheckIcon className="h-3 w-3" />
                  Resolve
                </Button>
              </div>
            )}

            {/* Flat message stream */}
            <div ref={channelScrollRef} className="flex-1 overflow-y-auto">
              <div className="px-4 py-4 flex flex-col gap-3">
                {channelFlatMessages
                  .filter(
                    (msg) =>
                      msg.messageType !== 'activity' ||
                      isTimelineVisibleEvent(
                        ((msg.contentData as Record<string, unknown>)
                          ?.eventType as string) ?? msg.content,
                      ),
                  )
                  .map((msg, idx, arr) => {
                    // Date divider: show at start of each new day
                    const msgDate = new Date(msg.createdAt).toDateString();
                    const prevDate =
                      idx > 0
                        ? new Date(arr[idx - 1].createdAt).toDateString()
                        : null;
                    const showDateDivider = idx === 0 || msgDate !== prevDate;

                    return (
                      <div key={msg.id}>
                        {/* Date divider */}
                        {showDateDivider && (
                          <div className="flex items-center gap-3 py-2 mb-1">
                            <div className="flex-1 border-t" />
                            <span className="text-[10px] text-muted-foreground/50 font-medium">
                              {new Date(msg.createdAt).toLocaleDateString(
                                undefined,
                                {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric',
                                },
                              )}
                            </span>
                            <div className="flex-1 border-t" />
                          </div>
                        )}
                        {/* Thread boundary divider */}
                        {conversationBoundaries.has(msg.id) && (
                          <div className="flex items-center gap-3 py-3 mb-3">
                            <div className="flex-1 border-t border-dashed" />
                            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                              New conversation
                            </span>
                            <div className="flex-1 border-t border-dashed" />
                          </div>
                        )}
                        <BlockMessageItem
                          message={msg}
                          senderMap={senderMap}
                          currentUserId={session?.user?.id}
                          channelType={
                            filteredConversations[0]?.channelType ?? 'web'
                          }
                          onRetry={(messageId) => {
                            retryMutation.mutate({
                              conversationId: msg._conversationId,
                              messageId,
                            });
                          }}
                        />
                      </div>
                    );
                  })}

                {contactLoading && (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full rounded-lg" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>
                )}
              </div>
            </div>

            {/* Reply input — active conversation or new conversation */}
            <div className="border-t px-4 py-2 bg-background">
              {activeChannelConversation ? (
                <BlockReplyInput
                  channelType={activeChannelConversation.channelType}
                  onSend={(content, isInternal) =>
                    replyMutation.mutate({
                      conversationId: activeChannelConversation.id,
                      content,
                      isInternal,
                    })
                  }
                  isPending={replyMutation.isPending}
                  error={replyMutation.isError ? 'Failed to send reply' : null}
                />
              ) : selectedChannel ? (
                <>
                  <p className="text-xs text-muted-foreground italic mb-1.5">
                    No active conversation — sending will start a new one.
                  </p>
                  <BlockReplyInput
                    channelType={selectedChannel.type}
                    onSend={(content, isInternal) =>
                      newConversationMutation.mutate({
                        channelInstanceId: selectedTabChannelId,
                        content,
                        isInternal,
                      })
                    }
                    isPending={newConversationMutation.isPending}
                    error={
                      newConversationMutation.isError
                        ? 'Failed to start conversation'
                        : null
                    }
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : (
          /* ── "All" tab: block view ── */
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-4 flex flex-col gap-4">
              {sortedConversations.map((conv) => {
                const msgs = messagesByConversation.get(conv.id) ?? [];
                return (
                  <div
                    key={conv.id}
                    id={`block-${conv.id}`}
                    data-block-id={conv.id}
                  >
                    <ConversationBlock
                      conversation={conv}
                      messages={msgs}
                      senderMap={senderMap}
                      isExpanded={expandedConversationIds.has(conv.id)}
                      currentUserId={session?.user?.id}
                      agents={agents}
                      onToggle={() => toggleBlock(conv.id)}
                      onUpdateConversation={(body) =>
                        updateConversationMutation.mutate({
                          id: conv.id,
                          body: body as Parameters<
                            typeof updateConversation
                          >[1],
                        })
                      }
                      onSendReply={(content, isInternal, replyToMessageId) =>
                        replyMutation.mutate({
                          conversationId: conv.id,
                          content,
                          isInternal,
                          replyToMessageId,
                        })
                      }
                      onRetryMessage={(messageId) =>
                        retryMutation.mutate({
                          conversationId: conv.id,
                          messageId,
                        })
                      }
                    />
                  </div>
                );
              })}

              {contactLoading && (
                <div className="space-y-3 px-1">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              )}

              {/* All failed alert */}
              {allConversations.length > 0 &&
                allConversations.every((i) => i.status === 'failed') && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                    <CircleAlertIcon className="h-4 w-4 shrink-0" />
                    All conversations for this contact have failed.
                  </div>
                )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Right sidebar ─── */}
      <div
        className={
          sidebarOpen
            ? 'w-[280px] shrink-0 border-l bg-muted/10 transition-all'
            : 'w-10 shrink-0 border-l bg-muted/10 transition-all flex flex-col items-center pt-2'
        }
      >
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Open sidebar"
          >
            <PanelRightIcon className="h-4 w-4" />
          </button>
        )}
        {sidebarOpen && (
          <>
            <div className="flex items-center justify-end px-3 pt-2 pb-1 shrink-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Close sidebar"
              >
                <PanelRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <div className="px-4 pb-4 space-y-4">
                {/* Contact info */}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    Contact
                  </p>
                  {contact ? (
                    <Link
                      to="/messaging/contacts/$contactId"
                      params={{ contactId: contact.id }}
                      className="flex items-center gap-2.5 rounded-md p-2 -mx-2 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                        <UserIcon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {contact.name ?? contact.id}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {contact.phone ?? contact.email ?? contact.role}
                        </p>
                      </div>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2.5 p-2 -mx-2">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3.5 w-32" />
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Conversations list */}
                <Collapsible defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center justify-between group">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Conversations ({allConversations.length})
                    </p>
                    <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1">
                    {sortedConversations.map((conv) => (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => scrollToBlock(conv.id)}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                          conv.id === visibleBlockId
                            ? 'bg-primary/10'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <ChannelBadge type={conv.channelType} variant="icon" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={
                                conv.status === 'active'
                                  ? 'default'
                                  : conv.status === 'failed'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="h-4 px-1 text-[10px]"
                            >
                              {conv.status}
                            </Badge>
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatRelativeTime(conv.startedAt)}
                        </span>
                      </button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>

                <Separator />

                {/* Contact-level labels */}
                <ContactLabelsSection contactId={contactId} />

                <Separator />

                {/* Details */}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    Details
                  </p>
                  <div className="space-y-0.5">
                    <SidebarRow label="Role">
                      <span className="capitalize">{contact?.role ?? '—'}</span>
                    </SidebarRow>
                    <SidebarRow label="Messages">
                      {String(allMessages.length)}
                      {hasNextPage ? '+' : ''}
                    </SidebarRow>
                    <SidebarRow label="Channels">
                      {channels.map((c) => c.type).join(', ') || '—'}
                    </SidebarRow>
                    <SidebarRow label="ID">
                      <span className="font-mono text-xs text-muted-foreground">
                        {contactId}
                      </span>
                    </SidebarRow>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/inbox/$contactId')({
  component: InboxDetailPage,
});
