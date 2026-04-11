import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  CheckIcon,
  CircleAlertIcon,
  EllipsisIcon,
  PanelRightIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  KbCurationBar,
  KbCurationToggle,
} from '@/components/chat/kb-curation-overlay';
import {
  AssigneeBadge,
  ChannelBadge,
  PriorityBadge,
  StatusBadge,
} from '@/components/conversation-badges';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useTypingListener,
  useTypingSender,
} from '@/hooks/use-typing-indicator';
import { agentsClient, messagingClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { extractStaffName } from '@/lib/normalize-message';
import { LabelsManager } from './_components/labels-manager';
import { MessageTimeline } from './_components/message-timeline';
import { StaffComposer } from './_components/staff-composer';
import type {
  MessageRow,
  SenderInfo,
  TimelineConversation,
} from './_components/types';

// ─── Types ────────────────────────────────────────────────────────────

interface ConversationDetail {
  id: string;
  agentId: string | null;
  contactId: string | null;
  channelInstanceId: string;
  channelRoutingId: string;
  status: string;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  assignee: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  outcome: string | null;
  reopenCount: number;
}

interface MessagesPage {
  messages: MessageRow[];
  hasMore: boolean;
  nextCursor?: string;
  conversations?: TimelineConversation[];
  currentConversationId?: string;
}

interface ChannelInstance {
  id: string;
  type: string;
  label: string;
}

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchConversation(id: string): Promise<ConversationDetail> {
  const res = await messagingClient.conversations[':id'].$get({
    param: { id },
  });
  if (!res.ok) throw new Error('Conversation not found');
  return res.json() as unknown as Promise<ConversationDetail>;
}

async function fetchMessagesPage(
  id: string,
  before?: string,
): Promise<MessagesPage> {
  const query: { limit: string; before?: string } = { limit: '50' };
  if (before) query.before = before;
  const res = await messagingClient.conversations[':id'][
    'timeline-messages'
  ].$get({
    param: { id },
    query,
  });
  if (!res.ok) return { messages: [], hasMore: false };
  const data = (await res.json()) as unknown as {
    messages: MessageRow[];
    hasMore: boolean;
    nextCursor?: string;
    conversations?: TimelineConversation[];
    currentConversationId?: string;
  };
  return {
    messages: data.messages ?? [],
    hasMore: data.hasMore,
    nextCursor: data.nextCursor,
    conversations: data.conversations,
    currentConversationId: data.currentConversationId,
  };
}

async function markConversationRead(id: string): Promise<void> {
  await messagingClient.conversations[':id'].read.$post({ param: { id } });
}

async function fetchContact(id: string): Promise<Contact | null> {
  const res = await messagingClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) return null;
  return res.json() as unknown as Promise<Contact>;
}

async function fetchChannelInstance(
  id: string,
): Promise<ChannelInstance | null> {
  const res = await messagingClient.instances[':id'].$get({
    param: { id },
  });
  if (!res.ok) return null;
  return res.json() as unknown as Promise<ChannelInstance>;
}

interface AgentInfo {
  id: string;
  name: string;
}

async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await agentsClient.agents.$get();
  if (!res.ok) return [];
  return res.json() as unknown as Promise<AgentInfo[]>;
}

async function updateConversation(
  id: string,
  body: {
    status?: 'resolved' | 'failed';
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
    assignee?: string | null;
    onHold?: boolean;
  },
): Promise<ConversationDetail> {
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
  return res.json() as unknown as Promise<ConversationDetail>;
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

// ─── Sidebar Detail Row ─────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────

function ConversationDetailPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('conv-sidebar') === 'open',
  );
  useEffect(() => {
    localStorage.setItem('conv-sidebar', sidebarOpen ? 'open' : 'closed');
  }, [sidebarOpen]);
  useTypingListener(conversationId);
  const {
    data: conversation,
    isLoading: conversationLoading,
    isError: conversationError,
  } = useQuery({
    queryKey: ['conversation-detail', conversationId],
    queryFn: () => fetchConversation(conversationId),
  });

  // Redirect to /inbox/:contactId#:conversationId
  useEffect(() => {
    if (!conversation?.contactId) return;
    navigate({
      to: '/messaging/inbox/$contactId',
      params: { contactId: conversation.contactId },
      hash: conversationId,
      replace: true,
    });
  }, [conversation?.contactId, conversationId, navigate]);

  const {
    data: messagesInfiniteData,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['conversations-messages', conversationId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchMessagesPage(conversationId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (firstPage) => firstPage.nextCursor,
    enabled: !!conversation,
    placeholderData: keepPreviousData,
  });

  // Flatten all pages into a single list (pages are loaded oldest-first via cursor)
  const allMessageRows = useMemo(
    () => messagesInfiniteData?.pages.flatMap((p) => p.messages) ?? [],
    [messagesInfiniteData],
  );

  // Timeline conversation metadata (from the first page — same for all pages)
  const timelineConversations = messagesInfiniteData?.pages[0]?.conversations;
  const timelineCurrentId =
    messagesInfiniteData?.pages[0]?.currentConversationId;

  // Mark conversation as read when opened or when new messages arrive
  const lastMsgId = allMessageRows[allMessageRows.length - 1]?.id;
  const hasMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastMsgId || hasMarkedRef.current === lastMsgId) return;
    hasMarkedRef.current = lastMsgId;
    markConversationRead(conversationId).catch(() => {});
  }, [conversationId, lastMsgId]);

  const { data: contact } = useQuery({
    queryKey: ['contacts', conversation?.contactId],
    queryFn: () => fetchContact(conversation?.contactId ?? ''),
    enabled: !!conversation?.contactId,
  });

  const { data: channelInstance } = useQuery({
    queryKey: ['channel-instance', conversation?.channelInstanceId],
    queryFn: () => fetchChannelInstance(conversation?.channelInstanceId ?? ''),
    enabled: !!conversation?.channelInstanceId,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Build sender map: senderId → { name, image? }
  const senderMap = useMemo(() => {
    const map = new Map<string, SenderInfo>();

    // Current user
    if (session?.user) {
      map.set(session.user.id, {
        name: session.user.name ?? session.user.email,
        image: session.user.image,
      });
    }

    // Contact
    if (contact && conversation?.contactId) {
      map.set(conversation.contactId, {
        name: contact.name ?? 'Customer',
      });
    }

    // Agents
    for (const agent of agents) {
      map.set(agent.id, { name: agent.name });
    }

    // Parse [Staff: Name] from message content for staff not in session
    for (const msg of allMessageRows) {
      if (msg.senderType === 'user' && !map.has(msg.senderId)) {
        const name = extractStaffName(msg.content);
        if (name) {
          map.set(msg.senderId, { name });
        }
      }
    }

    return map;
  }, [session, contact, conversation?.contactId, agents, allMessageRows]);

  const invalidateConversationQueries = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['conversation-detail', conversationId],
    });
    queryClient.invalidateQueries({ queryKey: ['conversations-attention'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-ai-active'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-resolved'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-counts'] });
  }, [queryClient, conversationId]);

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateConversation>[1]) =>
      updateConversation(conversationId, body),
    onSuccess: invalidateConversationQueries,
  });

  const invalidateMessages = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['conversations-messages', conversationId],
    });
  }, [queryClient, conversationId]);

  const { signalTyping } = useTypingSender(conversationId);

  const replyMutation = useMutation({
    mutationFn: (params: { text: string; internal: boolean }) =>
      sendReply(conversationId, params.text, params.internal),
    onSuccess: invalidateMessages,
  });

  const handleSendReply = useCallback(
    (content: string, isInternal: boolean) => {
      replyMutation.mutate({ text: content, internal: isInternal });
    },
    [replyMutation],
  );

  const handleRetryMessage = useCallback(
    async (messageId: string) => {
      await messagingClient.conversations[':id'].messages[':mid'].retry.$post({
        param: { id: conversationId, mid: messageId },
      });
      invalidateMessages();
    },
    [conversationId, invalidateMessages],
  );

  // ── Loading ──
  if (conversationLoading) {
    return (
      <div className="flex h-full">
        <div className="flex flex-1 flex-col">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-20 rounded" />
              <Skeleton className="h-5 w-16 rounded" />
            </div>
          </div>
          <div className="flex-1 px-4 pt-6">
            <div className="mx-auto w-full max-w-[44rem] flex flex-col gap-4">
              <Skeleton className="h-14 w-3/5" />
              <Skeleton className="ml-auto h-14 w-2/5" />
              <Skeleton className="h-14 w-3/5" />
            </div>
          </div>
        </div>
        <div className="w-[280px] border-l p-4 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  // ── Error ──
  if (conversationError || !conversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Conversation not found
          </p>
        </div>
      </div>
    );
  }

  const isTerminal =
    conversation.status === 'resolved' || conversation.status === 'failed';
  const canReply = !isTerminal;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Main panel ─── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="border-b bg-background">
          {/* Row 1: Navigation + contact + actions */}
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="text-base font-semibold truncate">
                {contact?.name ?? conversation.contactId ?? 'Unknown'}
              </h1>
              {channelInstance && (
                <ChannelBadge
                  type={channelInstance.type}
                  variant="badge"
                  className="shrink-0"
                />
              )}
              <RelativeTimeCard date={conversation.startedAt} />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <KbCurationToggle />
              {/* Overflow menu */}
              {!isTerminal && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <EllipsisIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({ status: 'resolved' })
                      }
                      className="gap-2 text-sm"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                      Mark resolved
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 text-xs text-destructive focus:text-destructive"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({ status: 'failed' })
                      }
                    >
                      <XCircleIcon className="h-3.5 w-3.5" />
                      Kill conversation
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Row 2: Property bar — Linear-style inline selectors */}
          <div className="flex items-center gap-1 px-4 pb-2.5">
            <StatusBadge status={conversation.status} className="mr-1" />

            <Separator orientation="vertical" className="h-4 mx-1" />

            <AssigneeBadge
              assignee={conversation.assignee}
              variant={isTerminal ? 'badge' : 'field'}
              onSelect={(v) => updateMutation.mutate({ assignee: v })}
              disabled={updateMutation.isPending}
              agents={agents}
            />

            <PriorityBadge
              priority={conversation.priority}
              variant={isTerminal ? 'badge' : 'field'}
              onSelect={(v) =>
                updateMutation.mutate({
                  priority: v as 'low' | 'normal' | 'high' | 'urgent' | null,
                })
              }
              disabled={updateMutation.isPending}
            />
          </div>
        </div>

        {/* Message Timeline */}
        <div className="flex-1 overflow-hidden">
          <MessageTimeline
            messages={allMessageRows}
            senderMap={senderMap}
            hasMore={!!hasNextPage}
            isFetchingMore={isFetchingNextPage}
            onLoadMore={() => fetchNextPage()}
            onRetryMessage={handleRetryMessage}
            timelineConversations={timelineConversations}
            currentConversationId={timelineCurrentId}
          />
        </div>

        <KbCurationBar />

        {/* Reply input */}
        {canReply && (
          <StaffComposer
            onSend={handleSendReply}
            isPending={replyMutation.isPending}
            error={replyMutation.isError ? 'Failed to send' : null}
            onTyping={signalTyping}
          />
        )}

        {/* Failed conversation alert */}
        {conversation.status === 'failed' && (
          <div className="flex items-center gap-2 border-t bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            <CircleAlertIcon className="h-4 w-4 shrink-0" />
            This conversation has failed and cannot be resumed.
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
                {/* Contact */}
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
                  ) : conversation.contactId ? (
                    <p className="text-xs text-muted-foreground font-mono">
                      {conversation.contactId}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No contact</p>
                  )}
                </div>

                <Separator />

                {/* Labels */}
                <LabelsManager conversationId={conversationId} />

                <Separator />

                {/* Details — 2-column grid */}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    Details
                  </p>
                  <div className="space-y-0.5">
                    <SidebarRow label="Agent">
                      {conversation.agentId ?? '—'}
                    </SidebarRow>
                    <SidebarRow label="Channel">
                      {channelInstance
                        ? channelInstance.label || channelInstance.type
                        : '—'}
                    </SidebarRow>
                    <SidebarRow label="Started">
                      <RelativeTimeCard date={conversation.startedAt} />
                    </SidebarRow>
                    {conversation.resolvedAt && (
                      <SidebarRow label="Resolved">
                        <RelativeTimeCard date={conversation.resolvedAt} />
                      </SidebarRow>
                    )}
                    <SidebarRow label="Messages">
                      {String(allMessageRows.length)}
                      {hasNextPage ? '+' : ''}
                    </SidebarRow>
                    {conversation.outcome && (
                      <SidebarRow label="Outcome">
                        <span className="capitalize">
                          {conversation.outcome.replaceAll('_', ' ')}
                        </span>
                      </SidebarRow>
                    )}
                    <SidebarRow label="ID">
                      <span className="font-mono text-xs text-muted-foreground">
                        {conversation.id}
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

export const Route = createFileRoute(
  '/_app/messaging/conversations/$conversationId',
)({
  component: ConversationDetailPage,
});
