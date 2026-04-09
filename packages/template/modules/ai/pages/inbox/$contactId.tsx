import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  CircleAlertIcon,
  PanelRightIcon,
  PlusIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChannelBadge } from '@/components/interaction-badges';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { formatRelativeTime } from '@/lib/format';
import { extractStaffName } from '@/lib/normalize-message';
import { useInboxDetailStore } from '@/stores/inbox-detail-store';
import { BlockReplyInput } from '../interactions/_components/block-reply-input';
import { InteractionBlock } from '../interactions/_components/interaction-block';
import { MessageTimeline } from '../interactions/_components/message-timeline';
import type {
  MessageRow,
  SenderInfo,
  TimelineInteraction,
  TimelineInteractionFull,
} from '../interactions/_components/types';

// ─── Types ────────────────────────────────────────────────────────────

interface TimelinePage {
  messages: MessageRow[];
  hasMore: boolean;
  nextCursor?: string | null;
  interactions: TimelineInteractionFull[];
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
  const res = await aiClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) throw new Error('Contact not found');
  return res.json() as Promise<Contact>;
}

async function fetchTimelinePage(
  contactId: string,
  before?: string,
): Promise<TimelinePage> {
  const query: { limit: string; before?: string } = { limit: '50' };
  if (before) query.before = before;
  const res = await aiClient.contacts[':id'].timeline.$get({
    param: { id: contactId },
    query,
  });
  if (!res.ok)
    return { messages: [], hasMore: false, interactions: [], channels: [] };
  const data = await res.json();
  return data as TimelinePage;
}

async function markContactRead(contactId: string): Promise<void> {
  await aiClient.contacts[':id']['mark-read'].$post({
    param: { id: contactId },
  });
}

async function fetchContactLabels(contactId: string): Promise<ContactLabel[]> {
  const res = await aiClient.contacts[':id'].labels.$get({
    param: { id: contactId },
  });
  if (!res.ok) return [];
  return res.json() as Promise<ContactLabel[]>;
}

async function fetchAllLabels(): Promise<
  { id: string; title: string; color: string | null }[]
> {
  const res = await aiClient.labels.$get();
  if (!res.ok) return [];
  return res.json() as Promise<
    { id: string; title: string; color: string | null }[]
  >;
}

async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await aiClient.agents.$get();
  if (!res.ok) return [];
  return res.json() as Promise<AgentInfo[]>;
}

async function sendReply(
  interactionId: string,
  content: string,
  isInternal = false,
): Promise<unknown> {
  const res = await aiClient.interactions[':id'].reply.$post(
    { param: { id: interactionId } },
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

async function createNewInteraction(
  contactId: string,
  channelInstanceId: string,
  content: string,
  isInternal: boolean,
): Promise<{ interactionId: string; messageId: string }> {
  const res = await aiClient.contacts[':id']['new-interaction'].$post(
    { param: { id: contactId } },
    {
      init: {
        body: JSON.stringify({ channelInstanceId, content, isInternal }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to create interaction');
  return res.json() as Promise<{
    interactionId: string;
    messageId: string;
  }>;
}

async function updateInteraction(
  id: string,
  body: {
    status?: 'resolved' | 'failed';
    mode?: 'held' | 'ai' | 'supervised' | 'human';
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
    assignee?: string | null;
  },
): Promise<unknown> {
  const res = await aiClient.interactions[':id'].$patch(
    { param: { id } },
    {
      init: {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to update interaction');
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
      aiClient.contacts[':id'].labels.$post(
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
      aiClient.contacts[':id'].labels[':labelId'].$delete({
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
    expandedInteractionIds,
    viewMode,
    selectedChannelId,
    toggleBlock,
    setDefaultExpansion,
    setViewMode,
    selectChannel,
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

  const {
    data: timelineData,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
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

  const allInteractions = useMemo(
    () => timelineData?.pages[0]?.interactions ?? [],
    [timelineData],
  );

  const channels = useMemo(
    () => timelineData?.pages[0]?.channels ?? [],
    [timelineData],
  );

  // Chronological sort for threads view
  const sortedInteractions = useMemo(
    () =>
      [...allInteractions].sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [allInteractions],
  );

  // Group messages by interactionId for per-block rendering
  const messagesByInteraction = useMemo(() => {
    const map = new Map<string, MessageRow[]>();
    for (const msg of allMessages) {
      const list = map.get(msg.interactionId) ?? [];
      list.push(msg);
      map.set(msg.interactionId, list);
    }
    return map;
  }, [allMessages]);

  // Timeline interactions (base type) for MessageTimeline in timeline view
  const timelineInteractions: TimelineInteraction[] = useMemo(
    () =>
      allInteractions.map((i) => ({
        id: i.id,
        status: i.status,
        outcome: i.outcome,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        reopenCount: i.reopenCount,
        mode: i.mode,
      })),
    [allInteractions],
  );

  // Map interactionId → channelType (for MessageTimeline segment coloring)
  const interactionChannelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of allInteractions) {
      map.set(i.id, i.channelType);
    }
    return map;
  }, [allInteractions]);

  const allTerminal = useMemo(
    () =>
      allInteractions.length > 0 &&
      allInteractions.every(
        (i) => i.status === 'resolved' || i.status === 'failed',
      ),
    [allInteractions],
  );

  // Selected channel for new-message flow
  const selectedChannel = useMemo(
    () =>
      channels.find((c) => c.id === selectedChannelId) ?? channels[0] ?? null,
    [channels, selectedChannelId],
  );

  // ── Effects ────────────────────────────────────────────────────────

  // Set default expansion once per contact when interactions first load
  const defaultExpansionContactRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      allInteractions.length > 0 &&
      defaultExpansionContactRef.current !== contactId
    ) {
      defaultExpansionContactRef.current = contactId;
      setDefaultExpansion(allInteractions);
    }
  }, [allInteractions, contactId, setDefaultExpansion]);

  // Scroll to first active block on initial load (threads view)
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (hasScrolledRef.current || sortedInteractions.length === 0) return;
    hasScrolledRef.current = true;
    const firstActive = sortedInteractions.find((i) => i.status === 'active');
    if (!firstActive) return;
    const el = document.getElementById(`block-${firstActive.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sortedInteractions]);

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
    if (sortedInteractions.length === 0) return;
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
    for (const interaction of sortedInteractions) {
      const el = document.getElementById(`block-${interaction.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sortedInteractions]);

  const scrollToBlock = useCallback((interactionId: string) => {
    document
      .getElementById(`block-${interactionId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['contact-timeline', contactId],
    });
    queryClient.invalidateQueries({ queryKey: ['interactions-attention'] });
    queryClient.invalidateQueries({ queryKey: ['interactions-active'] });
    queryClient.invalidateQueries({ queryKey: ['interactions-resolved'] });
    queryClient.invalidateQueries({ queryKey: ['interactions-counts'] });
  }, [queryClient, contactId]);

  const updateInteractionMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof updateInteraction>[1];
    }) => updateInteraction(id, body),
    onSuccess: invalidateAll,
  });

  const handbackMutation = useMutation({
    mutationFn: async (interactionId: string) => {
      const res = await aiClient.interactions[':id'].handback.$post({
        param: { id: interactionId },
      });
      if (!res.ok) throw new Error('Failed to hand back');
      return res.json();
    },
    onSuccess: invalidateAll,
  });

  const replyMutation = useMutation({
    mutationFn: ({
      interactionId,
      content,
      isInternal,
    }: {
      interactionId: string;
      content: string;
      isInternal: boolean;
      replyToMessageId?: string;
    }) => sendReply(interactionId, content, isInternal),
    onSuccess: invalidateAll,
  });

  const retryMutation = useMutation({
    mutationFn: ({
      interactionId,
      messageId,
    }: {
      interactionId: string;
      messageId: string;
    }) =>
      aiClient.interactions[':id'].messages[':mid'].retry.$post({
        param: { id: interactionId, mid: messageId },
      }),
    onSuccess: invalidateAll,
  });

  const newInteractionMutation = useMutation({
    mutationFn: ({
      channelInstanceId,
      content,
      isInternal,
    }: {
      channelInstanceId: string;
      content: string;
      isInternal: boolean;
    }) =>
      createNewInteraction(contactId, channelInstanceId, content, isInternal),
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
              {channels.map((ch) => (
                <ChannelBadge key={ch.id} type={ch.type} variant="badge" />
              ))}
              {contact && (
                <Link
                  to="/contacts/$contactId"
                  params={{ contactId: contact.id }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
                >
                  Profile
                </Link>
              )}
            </div>
          </div>

          {/* Threads | Timeline toggle */}
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode('threads')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'threads'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              Threads
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              Timeline
            </button>
          </div>
        </div>

        {/* ─── Threads view ─── */}
        {viewMode === 'threads' && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-4 flex flex-col gap-4">
              {sortedInteractions.map((interaction) => {
                const msgs = messagesByInteraction.get(interaction.id) ?? [];
                return (
                  <div
                    key={interaction.id}
                    id={`block-${interaction.id}`}
                    data-block-id={interaction.id}
                  >
                    <InteractionBlock
                      interaction={interaction}
                      messages={msgs}
                      senderMap={senderMap}
                      isExpanded={expandedInteractionIds.has(interaction.id)}
                      currentUserId={session?.user?.id}
                      onToggle={() => toggleBlock(interaction.id)}
                      onUpdateInteraction={(body) =>
                        updateInteractionMutation.mutate({
                          id: interaction.id,
                          body: body as Parameters<typeof updateInteraction>[1],
                        })
                      }
                      onHandback={() => handbackMutation.mutate(interaction.id)}
                      onSendReply={(content, isInternal, replyToMessageId) =>
                        replyMutation.mutate({
                          interactionId: interaction.id,
                          content,
                          isInternal,
                          replyToMessageId,
                        })
                      }
                      onRetryMessage={(messageId) =>
                        retryMutation.mutate({
                          interactionId: interaction.id,
                          messageId,
                        })
                      }
                    />
                  </div>
                );
              })}

              {/* Loading skeleton */}
              {contactLoading && (
                <div className="space-y-3 px-1">
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              )}

              {/* New message flow — all terminal */}
              {allTerminal && selectedChannel && (
                <div className="border-t pt-4">
                  {channels.length > 1 && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-xs text-muted-foreground">
                        Send on:
                      </span>
                      <Select
                        value={selectedChannelId ?? ''}
                        onValueChange={selectChannel}
                      >
                        <SelectTrigger className="h-7 w-auto text-xs gap-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {channels.map((ch) => (
                            <SelectItem
                              key={ch.id}
                              value={ch.id}
                              className="text-xs"
                            >
                              <div className="flex items-center gap-1.5">
                                <ChannelBadge type={ch.type} variant="icon" />
                                {ch.label ?? ch.type}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground italic px-1 mb-2">
                    This will start a new interaction.
                  </p>
                  <BlockReplyInput
                    channelType={selectedChannel.type}
                    interactionTitle={selectedChannel.label ?? undefined}
                    onSend={(content, isInternal) =>
                      newInteractionMutation.mutate({
                        channelInstanceId: selectedChannel.id,
                        content,
                        isInternal,
                      })
                    }
                    isPending={newInteractionMutation.isPending}
                    error={
                      newInteractionMutation.isError
                        ? 'Failed to start interaction'
                        : null
                    }
                  />
                </div>
              )}

              {/* All failed alert */}
              {allInteractions.length > 0 &&
                allInteractions.every((i) => i.status === 'failed') && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                    <CircleAlertIcon className="h-4 w-4 shrink-0" />
                    All interactions for this contact have failed.
                  </div>
                )}
            </div>
          </div>
        )}

        {/* ─── Timeline view (read-only audit) ─── */}
        {viewMode === 'timeline' && (
          <div className="flex-1 overflow-hidden">
            <MessageTimeline
              key={contactId}
              messages={allMessages}
              senderMap={senderMap}
              hasMore={!!hasNextPage}
              isFetchingMore={isFetchingNextPage}
              onLoadMore={() => fetchNextPage()}
              timelineInteractions={timelineInteractions}
              interactionChannelMap={interactionChannelMap}
              currentUserId={session?.user?.id}
              isMultiChannel={channels.length > 1}
            />
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
                      to="/contacts/$contactId"
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

                {/* Interactions list */}
                <Collapsible defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center justify-between group">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Interactions ({allInteractions.length})
                    </p>
                    <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1">
                    {sortedInteractions.map((interaction) => (
                      <button
                        key={interaction.id}
                        type="button"
                        onClick={() => scrollToBlock(interaction.id)}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                          interaction.id === visibleBlockId
                            ? 'bg-primary/10'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <ChannelBadge
                          type={interaction.channelType}
                          variant="icon"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={
                                interaction.status === 'active'
                                  ? 'default'
                                  : interaction.status === 'failed'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="h-4 px-1 text-[10px]"
                            >
                              {interaction.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground capitalize">
                              {interaction.mode}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatRelativeTime(interaction.startedAt)}
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

export const Route = createFileRoute('/_app/inbox/$contactId')({
  component: InboxDetailPage,
});
