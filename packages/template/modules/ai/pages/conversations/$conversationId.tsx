import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CornerDownLeftIcon,
  MessageSquareIcon,
  PauseCircleIcon,
  SendIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { MessagePartsRenderer } from '@/components/chat/message-parts-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { aiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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
  handler: 'ai' | 'human' | 'supervised' | 'paused' | null;
  assignedUserId: string | null;
  resolutionOutcome: string | null;
}

interface MemoryMessage {
  id: string;
  role: string;
  content:
    | string
    | { type: string; text?: string; [key: string]: unknown }[]
    | { format: number; parts: { type: string; [key: string]: unknown }[] };
  createdAt?: string;
  deliveryStatus?: string;
}

interface OutboxRecord {
  id: string;
  content: string;
  status: string;
  createdAt: string;
}

interface ChannelInstance {
  id: string;
  type: string;
  label: string;
}

interface MessagesResponse {
  messages: MemoryMessage[];
  outboxRecords?: OutboxRecord[];
  source?: 'memory' | 'outbox';
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

async function fetchMessages(id: string): Promise<MessagesResponse> {
  const res = await aiClient.conversations[':id'].messages.$get({
    param: { id },
  });
  if (!res.ok) return { messages: [] };
  return res.json() as unknown as Promise<MessagesResponse>;
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

async function updateConversationStatus(
  id: string,
  status: 'paused' | 'completed' | 'failed',
): Promise<ConversationDetail> {
  const res = await aiClient.conversations[':id'].$patch(
    { param: { id } },
    {
      init: {
        body: JSON.stringify({ status }),
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
): Promise<unknown> {
  const res = await aiClient.conversations[':id'].reply.$post(
    { param: { id: conversationId } },
    {
      init: {
        body: JSON.stringify({ content }),
        headers: { 'Content-Type': 'application/json' },
      },
    },
  );
  if (!res.ok) throw new Error('Failed to send reply');
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractText(content: MemoryMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => (p.text as string) ?? '')
      .join('');
  }
  if (content && typeof content === 'object' && 'parts' in content) {
    return (content as { parts: { type: string; text?: string }[] }).parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text ?? '')
      .join('');
  }
  return '';
}

function convertMemoryPart(part: {
  type: string;
  [key: string]: unknown;
}): { type: string; [key: string]: unknown }[] {
  if (part.type === 'text') {
    return [{ type: 'text', text: part.text }];
  }
  if (part.type === 'tool-call') {
    const toolName = part.toolName as string;
    const result = part.result;
    return [
      {
        type: `tool-${toolName}`,
        state: result !== undefined ? 'output-available' : 'input-available',
        ...(result !== undefined ? { output: result } : { input: part.args }),
      },
    ];
  }
  return [part];
}

function getMessageParts(
  content: MemoryMessage['content'],
): { type: string; [key: string]: unknown }[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content.flatMap((p) =>
      convertMemoryPart(p as { type: string; [key: string]: unknown }),
    );
  }
  if (content && typeof content === 'object' && 'parts' in content) {
    return (
      content as { parts: { type: string; [key: string]: unknown }[] }
    ).parts.flatMap((p) => convertMemoryPart(p));
  }
  return [];
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'paused') return 'outline';
  return 'secondary';
}

function consultationStatusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'pending') return 'outline';
  if (status === 'replied') return 'success';
  if (status === 'timeout') return 'destructive';
  return 'secondary';
}

function handlerVariant(handler: string): 'default' | 'secondary' | 'outline' {
  if (handler === 'ai') return 'default';
  if (handler === 'paused') return 'secondary';
  return 'outline'; // human, supervised
}

function handlerColor(handler: string): string {
  if (handler === 'human') return 'text-orange-600 dark:text-orange-400';
  if (handler === 'supervised') return 'text-yellow-600 dark:text-yellow-400';
  return '';
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ─── Human Reply Input ───────────────────────────────────────────────

function HumanReplyInput({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const replyMutation = useMutation({
    mutationFn: (text: string) => sendReply(conversationId, text),
    onSuccess: () => {
      setContent('');
      onSent();
    },
    onError: (err) => {
      console.error('[conversation-reply] Failed:', err);
    },
  });

  function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed || replyMutation.isPending) return;
    replyMutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply as team member..."
          className="min-h-[60px] max-h-[120px] resize-none text-sm"
          rows={2}
        />
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={!content.trim() || replyMutation.isPending}
          onClick={handleSubmit}
        >
          <SendIcon className="h-3.5 w-3.5" />
          Send
        </Button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          <kbd className="rounded border bg-muted px-1 py-0.5 text-[9px]">
            {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
          </kbd>{' '}
          to send
        </p>
        {replyMutation.isError && (
          <p className="text-[10px] text-destructive">Failed to send reply</p>
        )}
      </div>
    </div>
  );
}

// ─── Consultation Card ───────────────────────────────────────────────

function ConsultationCard({ consultation }: { consultation: Consultation }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge
            variant={consultationStatusVariant(consultation.status)}
            className="text-[10px] capitalize"
          >
            {consultation.status}
          </Badge>
          <span className="text-[10px] text-muted-foreground capitalize">
            {consultation.channelType}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(consultation.requestedAt)}
          </span>
        </div>
        <p className="text-xs text-foreground">{consultation.reason}</p>
        {consultation.summary && (
          <p className="mt-1 text-xs text-muted-foreground italic">
            Reply: {consultation.summary}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function ConversationDetailPage() {
  const { conversationId } = Route.useParams();
  const queryClient = useQueryClient();

  const {
    data: conversation,
    isLoading: conversationLoading,
    isError: conversationError,
  } = useQuery({
    queryKey: ['conversations-list', conversationId],
    queryFn: () => fetchConversation(conversationId),
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['conversations-messages', conversationId],
    queryFn: () => fetchMessages(conversationId),
    enabled: !!conversation,
  });

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

  const updateMutation = useMutation({
    mutationFn: (status: 'paused' | 'completed' | 'failed') =>
      updateConversationStatus(conversationId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['conversations-list', conversationId],
      });
      queryClient.invalidateQueries({ queryKey: ['conversations-list'] });
    },
  });

  const handbackMutation = useMutation({
    mutationFn: async () => {
      const res = await aiClient.conversations[':id'].handback.$post({
        param: { id: conversationId },
      });
      if (!res.ok) throw new Error('Failed to hand back');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['conversations-list', conversationId],
      });
    },
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
      queryClient.invalidateQueries({
        queryKey: ['conversations-list', conversationId],
      });
    },
    onError: (err: Error) => {
      setApproveDraftError(err.message);
    },
  });

  function invalidateMessages() {
    queryClient.invalidateQueries({
      queryKey: ['conversations-messages', conversationId],
    });
  }

  if (conversationLoading) {
    return (
      <div className="flex h-full">
        <div className="flex-1 p-6">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-[500px] w-full" />
        </div>
        <div className="w-72 border-l p-4">
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (conversationError || !conversation) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Conversation not found.</p>
        <Link
          to="/"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <CornerDownLeftIcon className="h-3.5 w-3.5" />
          Back to conversations
        </Link>
      </div>
    );
  }

  const messages = messagesData?.messages ?? [];
  const outboxByContent = new Map<string, string>(
    (messagesData?.outboxRecords ?? []).map((r) => [r.content, r.status]),
  );
  const isTerminal =
    conversation.status === 'completed' || conversation.status === 'failed';
  const canReply = !isTerminal;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Main panel — transcript + reply */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header bar */}
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
            <Link
              to="/"
              className="hover:text-foreground transition-colors shrink-0"
            >
              Conversations
            </Link>
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="text-foreground font-medium font-mono text-xs truncate">
              {conversation.id}
            </span>
            {channelInstance && (
              <Badge
                variant="outline"
                className="text-[10px] font-normal shrink-0"
              >
                {channelInstance.type === 'whatsapp'
                  ? 'WhatsApp'
                  : channelInstance.type === 'web'
                    ? 'Web'
                    : channelInstance.type}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {messagesData?.source === 'outbox' && messages.length > 0 && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                AI responses only
              </span>
            )}
            {!isTerminal && (
              <>
                {(conversation.handler === 'human' ||
                  conversation.handler === 'supervised') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    disabled={handbackMutation.isPending}
                    onClick={() => handbackMutation.mutate()}
                  >
                    <BotIcon className="h-3.5 w-3.5" />
                    Hand Back to AI
                  </Button>
                )}
                {conversation.handler === 'supervised' && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    disabled={approveDraftMutation.isPending}
                    onClick={() => approveDraftMutation.mutate()}
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    Approve Draft
                  </Button>
                )}
                {approveDraftError && (
                  <span className="text-[10px] text-destructive">
                    {approveDraftError}
                  </span>
                )}
                {conversation.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-muted-foreground"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate('paused')}
                  >
                    <PauseCircleIcon className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate('failed')}
                >
                  <XCircleIcon className="h-3.5 w-3.5" />
                  Kill
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Transcript using ai-elements */}
        <div className="flex-1 overflow-hidden">
          {messagesLoading ? (
            <div className="flex flex-col gap-4 p-6">
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="ml-auto h-16 w-2/3" />
              <Skeleton className="h-16 w-3/4" />
            </div>
          ) : messages.length === 0 ? (
            <ConversationEmptyState
              title="No messages yet"
              description="Messages will appear once the conversation starts"
              icon={<MessageSquareIcon className="h-8 w-8" />}
            />
          ) : (
            <Conversation className="h-full">
              <ConversationContent className="gap-6 px-6 py-4">
                {messages.map((msg) => {
                  const parts = getMessageParts(msg.content);
                  if (parts.length === 0) return null;
                  const role = msg.role === 'user' ? 'user' : 'assistant';

                  const msgText = extractText(msg.content);
                  const deliveryStatus =
                    role === 'assistant'
                      ? (msg.deliveryStatus ?? outboxByContent.get(msgText))
                      : undefined;

                  const contactLabel = contact?.name ?? 'Visitor';

                  // Detect staff replies: text starts with "[Staff: Name]"
                  const staffMatch = msgText.match(/^\[Staff:\s*(.+?)\]\s*/);
                  const isStaffReply = role === 'assistant' && !!staffMatch;
                  const senderLabel = isStaffReply
                    ? staffMatch[1]
                    : role === 'user'
                      ? contactLabel
                      : 'AI Agent';

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-lg px-3 py-2',
                        role === 'user'
                          ? 'bg-muted/60 border border-border/50'
                          : '',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        {role === 'user' ? (
                          <UserIcon className="h-3 w-3 text-muted-foreground" />
                        ) : isStaffReply ? (
                          <UserIcon className="h-3 w-3 text-blue-500" />
                        ) : (
                          <BotIcon className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span
                          className={cn(
                            'text-[10px] font-medium',
                            role === 'user'
                              ? 'text-foreground'
                              : isStaffReply
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-muted-foreground',
                          )}
                        >
                          {senderLabel}
                        </span>
                        {msg.createdAt && (
                          <span className="text-[10px] text-muted-foreground/60">
                            {formatRelativeTime(msg.createdAt)}
                          </span>
                        )}
                        {deliveryStatus && (
                          <span
                            className={cn(
                              'text-[10px]',
                              deliveryStatus === 'delivered' ||
                                deliveryStatus === 'read'
                                ? 'text-green-600 dark:text-green-400'
                                : deliveryStatus === 'failed'
                                  ? 'text-destructive'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {deliveryStatus}
                          </span>
                        )}
                      </div>
                      <div className="pl-[18px] prose-sm prose-neutral dark:prose-invert max-w-none [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_p]:text-sm [&_li]:text-sm [&_ol]:text-sm [&_ul]:text-sm">
                        <MessagePartsRenderer
                          parts={parts}
                          messageId={msg.id}
                          readOnly
                        />
                      </div>
                    </div>
                  );
                })}
              </ConversationContent>
            </Conversation>
          )}
        </div>

        {/* Human reply input */}
        {canReply && (
          <HumanReplyInput
            conversationId={conversationId}
            onSent={invalidateMessages}
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

      {/* Right sidebar — metadata + consultations */}
      <div className="w-72 shrink-0 overflow-y-auto border-l bg-muted/20">
        <div className="p-4 space-y-4">
          {/* Status */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Status
            </p>
            <Badge
              variant={statusVariant(conversation.status)}
              className="capitalize"
            >
              {conversation.status}
            </Badge>
            {/* Handler Mode */}
            {conversation.handler && (
              <Badge
                variant={handlerVariant(conversation.handler)}
                className={cn(
                  'capitalize mt-1',
                  handlerColor(conversation.handler),
                )}
              >
                {conversation.handler === 'ai' ? 'AI' : conversation.handler}
              </Badge>
            )}
          </div>

          <Separator />

          {/* Contact */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Contact
            </p>
            {contact ? (
              <Link
                to="/contacts/$contactId"
                params={{ contactId: contact.id }}
                className="flex items-center gap-2 rounded-md p-2 -mx-2 hover:bg-muted transition-colors"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                  <UserIcon className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {contact.name ?? contact.id}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
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

          {/* Details */}
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Details
            </p>
            <div className="space-y-1.5">
              <DetailRow label="AI Agent" value={conversation.agentId ?? '—'} />
              <DetailRow label="Type" value={conversation.conversationType} />
              <DetailRow
                label="Started"
                value={new Date(conversation.startedAt).toLocaleString()}
              />
              {conversation.endedAt && (
                <DetailRow
                  label="Ended"
                  value={new Date(conversation.endedAt).toLocaleString()}
                />
              )}
              <DetailRow label="Messages" value={String(messages.length)} />
              {conversation.assignedUserId && (
                <DetailRow
                  label="Assigned To"
                  value={conversation.assignedUserId}
                />
              )}
              {conversation.resolutionOutcome && (
                <DetailRow
                  label="Resolution"
                  value={conversation.resolutionOutcome}
                />
              )}
            </div>
          </div>

          {/* Consultations */}
          {consultations.length > 0 && (
            <>
              <Separator />
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Escalations ({consultations.length})
                  </p>
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
                  <CollapsibleTrigger className="flex w-full items-center justify-between">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Contact Memory
                    </p>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
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
                      <div className="space-y-1">
                        {memoryFacts.map((fact) => (
                          <div
                            key={fact.id}
                            className="flex items-start gap-1.5 text-[10px]"
                          >
                            <BrainIcon className="h-3 w-3 text-primary/50 mt-0.5 shrink-0" />
                            <span className="text-muted-foreground line-clamp-2">
                              {fact.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <Link
                      to="/contacts/$contactId"
                      params={{ contactId: conversation.contactId }}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View all memory &rarr;
                    </Link>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground truncate text-right">
        {value}
      </span>
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/$conversationId')({
  component: ConversationDetailPage,
});
