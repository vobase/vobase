import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
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
  ModeBadge,
  PriorityBadge,
  StatusBadge,
} from '@/components/conversation-badges';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useTypingListener,
  useTypingSender,
} from '@/hooks/use-typing-indicator';
import { aiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LabelsManager } from './_components/labels-manager';
import { MessageTimeline } from './_components/message-timeline';
import { StaffComposer } from './_components/staff-composer';
import type { MessageRow } from './_components/types';

// ─── Types ────────────────────────────────────────────────────────────

interface ConversationDetail {
  id: string;
  agentId: string | null;
  contactId: string | null;
  channelInstanceId: string;
  channelRoutingId: string;
  conversationType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  mode: 'ai' | 'human' | 'supervised' | 'held' | null;
  assignee: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  resolutionOutcome: string | null;
}

interface MessagesPage {
  messages: MessageRow[];
  hasMore: boolean;
  nextCursor?: string;
}

interface ChannelInstance {
  id: string;
  type: string;
  label: string;
}

interface Consultation {
  id: string;
  conversationId: string;
  staffContactId: string;
  channelType: string;
  reason: string;
  summary: string | null;
  status: string;
  requestedAt: string;
  repliedAt: string | null;
  timeoutMinutes: number;
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
  const res = await aiClient.conversations[':id'].$get({
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
  const res = await aiClient.conversations[':id'].messages.$get({
    param: { id },
    query,
  });
  if (!res.ok) return { messages: [], hasMore: false };
  const data = (await res.json()) as {
    messages: MessageRow[];
    hasMore: boolean;
    nextCursor?: string;
  };
  return {
    messages: data.messages ?? [],
    hasMore: data.hasMore,
    nextCursor: data.nextCursor,
  };
}

async function markConversationRead(id: string): Promise<void> {
  await aiClient.conversations[':id'].read.$post({ param: { id } });
}

async function fetchConsultations(id: string): Promise<Consultation[]> {
  const res = await aiClient.conversations[':id'].consultations.$get({
    param: { id },
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchContact(id: string): Promise<Contact | null> {
  const res = await aiClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) return null;
  return res.json() as unknown as Promise<Contact>;
}

async function fetchChannelInstance(
  id: string,
): Promise<ChannelInstance | null> {
  const res = await aiClient.instances[':id'].$get({
    param: { id },
  });
  if (!res.ok) return null;
  return res.json() as unknown as Promise<ChannelInstance>;
}

interface MemoryStats {
  cells: number;
  episodes: number;
  facts: number;
}

interface MemoryFact {
  id: string;
  content: string;
  createdAt: string;
}

async function fetchContactMemoryStats(
  contactId: string,
): Promise<MemoryStats> {
  const res = await aiClient.memory.stats.$get({
    query: { scope: `contact:${contactId}` },
  });
  if (!res.ok) return { cells: 0, episodes: 0, facts: 0 };
  return res.json();
}

async function fetchContactFacts(contactId: string): Promise<MemoryFact[]> {
  const res = await aiClient.memory.facts.$get({
    query: { scope: `contact:${contactId}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown as {
    facts?: Array<{ id: string; fact: string; createdAt: string }>;
  };
  return (data.facts ?? [])
    .slice(0, 5)
    .map((f) => ({ id: f.id, content: f.fact, createdAt: f.createdAt }));
}

async function updateConversation(
  id: string,
  body: {
    status?: 'completed' | 'failed';
    mode?: 'held' | 'ai' | 'supervised' | 'human';
    priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
    assignee?: string | null;
  },
): Promise<ConversationDetail> {
  const res = await aiClient.conversations[':id'].$patch(
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
  const res = await aiClient.conversations[':id'].reply.$post(
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

// ─── Helpers ──────────────────────────────────────────────────────────

function consultationStatusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'pending') return 'outline';
  if (status === 'replied') return 'success';
  if (status === 'timeout') return 'destructive';
  return 'secondary';
}

// ─── Consultation Card ───────────────────────────────────────────────

function ConsultationCard({ consultation }: { consultation: Consultation }) {
  return (
    <div className="rounded-md border bg-background p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Badge
          variant={consultationStatusVariant(consultation.status)}
          className="text-xs capitalize h-4 px-1.5"
        >
          {consultation.status}
        </Badge>
        <span className="text-xs text-muted-foreground capitalize">
          {consultation.channelType}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatRelativeTime(consultation.requestedAt)}
        </span>
      </div>
      <p className="text-sm text-foreground leading-relaxed">
        {consultation.reason}
      </p>
      {consultation.summary && (
        <p className="mt-1.5 text-sm text-muted-foreground italic leading-relaxed">
          {consultation.summary}
        </p>
      )}
    </div>
  );
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

  // Mark conversation as read when opened or when new messages arrive
  const lastMsgId = allMessageRows[allMessageRows.length - 1]?.id;
  const hasMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastMsgId || hasMarkedRef.current === lastMsgId) return;
    hasMarkedRef.current = lastMsgId;
    markConversationRead(conversationId).catch(() => {});
  }, [conversationId, lastMsgId]);

  const { data: consultations = [] } = useQuery({
    queryKey: ['conversations-consultations', conversationId],
    queryFn: () => fetchConsultations(conversationId),
    enabled: !!conversation,
  });

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

  const { data: memoryStats } = useQuery({
    queryKey: ['memory-stats', `contact:${conversation?.contactId}`],
    queryFn: () => fetchContactMemoryStats(conversation?.contactId ?? ''),
    enabled: !!conversation?.contactId,
  });

  const { data: memoryFacts = [] } = useQuery({
    queryKey: ['memory-facts', `contact:${conversation?.contactId}`],
    queryFn: () => fetchContactFacts(conversation?.contactId ?? ''),
    enabled: !!conversation?.contactId && (memoryStats?.facts ?? 0) > 0,
  });

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

  const handbackMutation = useMutation({
    mutationFn: async () => {
      const res = await aiClient.conversations[':id'].handback.$post({
        param: { id: conversationId },
      });
      if (!res.ok) throw new Error('Failed to hand back');
      return res.json();
    },
    onSuccess: invalidateConversationQueries,
  });

  const [approveDraftError, setApproveDraftError] = useState<string | null>(
    null,
  );
  const approveDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await aiClient.conversations[':id']['approve-draft'].$post({
        param: { id: conversationId },
      });
      if (res.status === 404) throw new Error('No draft to approve');
      if (res.status === 409) throw new Error('Draft already approved');
      if (!res.ok) throw new Error('Failed to approve draft');
      return res.json();
    },
    onSuccess: () => {
      setApproveDraftError(null);
      invalidateConversationQueries();
    },
    onError: (err: Error) => {
      setApproveDraftError(err.message);
    },
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
      await aiClient.conversations[':id'].messages[':mid'].retry.$post({
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
    conversation.status === 'completed' || conversation.status === 'failed';
  const canReply = !isTerminal;
  const currentMode = conversation.mode ?? 'ai';
  const isAssignedToMe = conversation.assignee === session?.user?.id;

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
              <span className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(conversation.startedAt)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <KbCurationToggle />
              {/* Supervised: approve draft */}
              {!isTerminal && conversation.mode === 'supervised' && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 gap-1.5 text-sm"
                  disabled={approveDraftMutation.isPending}
                  onClick={() => approveDraftMutation.mutate()}
                >
                  <CheckIcon className="h-3.5 w-3.5" />
                  Approve
                </Button>
              )}
              {approveDraftError && (
                <span className="text-sm text-destructive">
                  {approveDraftError}
                </span>
              )}
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
                        updateMutation.mutate({ status: 'completed' })
                      }
                      className="gap-2 text-sm"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                      Mark resolved
                    </DropdownMenuItem>
                    {(conversation.mode === 'human' ||
                      conversation.mode === 'supervised' ||
                      conversation.mode === 'held') && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={handbackMutation.isPending}
                          onClick={() => handbackMutation.mutate()}
                          className="gap-2 text-sm"
                        >
                          <BotIcon className="h-3.5 w-3.5 text-violet-500" />
                          Hand back to AI
                        </DropdownMenuItem>
                      </>
                    )}
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

            <ModeBadge
              mode={currentMode}
              variant={isTerminal ? 'badge' : 'field'}
              onSelect={(v) =>
                updateMutation.mutate({
                  mode: v as 'ai' | 'supervised' | 'human' | 'held',
                })
              }
              disabled={updateMutation.isPending}
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

            <Separator orientation="vertical" className="h-4 mx-1" />

            <AssigneeBadge
              assignee={conversation.assignee}
              isMe={isAssignedToMe}
              variant={isTerminal ? 'badge' : 'field'}
              onAssign={() =>
                updateMutation.mutate({
                  assignee: session?.user?.id ?? null,
                })
              }
              onUnassign={() => updateMutation.mutate({ assignee: null })}
              disabled={updateMutation.isPending}
            />
          </div>
        </div>

        {/* Message Timeline */}
        <div className="flex-1 overflow-hidden">
          <MessageTimeline
            messages={allMessageRows}
            contactName={contact?.name ?? undefined}
            hasMore={!!hasNextPage}
            isFetchingMore={isFetchingNextPage}
            onLoadMore={() => fetchNextPage()}
            onRetryMessage={handleRetryMessage}
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
                      {formatRelativeTime(conversation.startedAt)}
                    </SidebarRow>
                    {conversation.endedAt && (
                      <SidebarRow label="Ended">
                        {formatRelativeTime(conversation.endedAt)}
                      </SidebarRow>
                    )}
                    <SidebarRow label="Messages">
                      {String(allMessageRows.length)}
                      {hasNextPage ? '+' : ''}
                    </SidebarRow>
                    {conversation.resolutionOutcome && (
                      <SidebarRow label="Resolution">
                        <span className="capitalize">
                          {conversation.resolutionOutcome.replaceAll('_', ' ')}
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

                {/* Consultations */}
                {consultations.length > 0 && (
                  <>
                    <Separator />
                    <Collapsible defaultOpen>
                      <CollapsibleTrigger className="flex w-full items-center justify-between group">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Escalations ({consultations.length})
                        </p>
                        <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2">
                        {consultations.map((c) => (
                          <ConsultationCard key={c.id} consultation={c} />
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                )}

                {/* Contact Memory */}
                {conversation.contactId &&
                  memoryStats &&
                  (memoryStats.facts > 0 ||
                    memoryStats.episodes > 0 ||
                    memoryStats.cells > 0) && (
                    <>
                      <Separator />
                      <Collapsible defaultOpen>
                        <CollapsibleTrigger className="flex w-full items-center justify-between group">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Memory
                          </p>
                          <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-2">
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <span>
                              <span className="font-medium text-foreground">
                                {memoryStats.facts}
                              </span>{' '}
                              facts
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {memoryStats.episodes}
                              </span>{' '}
                              episodes
                            </span>
                            <span>
                              <span className="font-medium text-foreground">
                                {memoryStats.cells}
                              </span>{' '}
                              cells
                            </span>
                          </div>
                          {memoryFacts.length > 0 && (
                            <div className="space-y-1.5">
                              {memoryFacts.map((fact) => (
                                <div
                                  key={fact.id}
                                  className="flex items-start gap-1.5 text-sm"
                                >
                                  <BrainIcon className="h-3 w-3 text-primary/40 mt-0.5 shrink-0" />
                                  <span className="text-muted-foreground line-clamp-2 leading-relaxed">
                                    {fact.content}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <Link
                            to="/contacts/$contactId"
                            params={{ contactId: conversation.contactId }}
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                          >
                            View all memory &rarr;
                          </Link>
                        </CollapsibleContent>
                      </Collapsible>
                    </>
                  )}
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/$conversationId')({
  component: ConversationDetailPage,
});
