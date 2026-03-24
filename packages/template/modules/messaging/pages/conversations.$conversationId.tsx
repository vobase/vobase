import { useChat } from '@ai-sdk/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { DefaultChatTransport, type TextUIPart, type UIMessage } from 'ai';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  CopyIcon,
  Globe,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
  Send,
  Tag,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────

interface ConversationData {
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

interface ConversationWithMessages extends ConversationData {
  messages: DbMessage[];
}

interface DbMessage {
  id: string;
  conversationId: string;
  aiRole: string | null;
  content: string | null;
  sources: string | null;
  toolCalls: string | null;
  createdAt: string;
}

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  channel: string | null;
}

interface Team {
  id: string;
  name: string;
}

interface LabelData {
  id: string;
  name: string;
  color: string | null;
}

interface ConversationLabel {
  labelId: string;
  label: LabelData;
}

// ─── Fetchers ────────────────────────────────────────────────────────

async function fetchConversation(
  id: string,
): Promise<ConversationWithMessages> {
  const res = await fetch(`/api/messaging/conversations/${id}`);
  if (!res.ok) throw new Error('Failed to fetch conversation');
  return res.json();
}

async function fetchContact(id: string): Promise<Contact> {
  const res = await fetch(`/api/messaging/contacts/${id}`);
  if (!res.ok) throw new Error('Failed to fetch contact');
  return res.json();
}

async function fetchTeams(): Promise<Team[]> {
  const res = await fetch('/api/messaging/teams');
  if (!res.ok) return [];
  return res.json();
}

async function fetchLabels(): Promise<LabelData[]> {
  const res = await fetch('/api/messaging/labels');
  if (!res.ok) return [];
  return res.json();
}

async function fetchConversationLabels(
  conversationId: string,
): Promise<ConversationLabel[]> {
  const res = await fetch(
    `/api/messaging/conversations/${conversationId}/labels`,
  );
  if (!res.ok) return [];
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toUIMessages(dbMessages: DbMessage[]): UIMessage[] {
  return dbMessages.map((msg) => ({
    id: msg.id,
    role: (msg.aiRole ?? 'user') as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: msg.content ?? '' }],
    createdAt: new Date(msg.createdAt),
  }));
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-emerald-500',
  pending: 'bg-amber-500',
  resolved: 'bg-gray-400',
  snoozed: 'bg-blue-500',
  closed: 'bg-gray-300 dark:bg-gray-600',
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

function isToolPart(part: unknown): part is {
  toolName: string;
  toolCallId: string;
  state: string;
  output?: unknown;
} {
  return (
    typeof part === 'object' &&
    part !== null &&
    'toolName' in part &&
    'toolCallId' in part
  );
}

// ─── Tool Call Part ──────────────────────────────────────────────────

function ToolCallPart({
  part,
}: {
  part: {
    toolName: string;
    toolCallId: string;
    state: string;
    output?: unknown;
  };
}) {
  const isRunning =
    part.state === 'input-streaming' || part.state === 'input-available';
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      {isRunning ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <CheckCircle2 className="size-3" />
      )}
      <Wrench className="size-3" />
      <span className="font-medium">{part.toolName}</span>
      {part.state === 'output-available' && part.output != null && (
        <span className="truncate max-w-[300px]">
          {typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output).slice(0, 120)}
        </span>
      )}
    </div>
  );
}

// ─── Escalation Banner ──────────────────────────────────────────────

function EscalationBanner({
  conversation,
  onResumeAI,
  isResuming,
}: {
  conversation: ConversationData;
  onResumeAI: () => void;
  isResuming: boolean;
}) {
  if (conversation.status !== 'pending' || conversation.handler !== 'human') {
    return null;
  }

  return (
    <div className="mx-4 mt-3 mb-1 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Escalated to human
          </p>
          {conversation.escalationReason && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <span className="font-medium">Reason:</span>{' '}
              {conversation.escalationReason}
            </p>
          )}
          {conversation.escalationSummary && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <span className="font-medium">Summary:</span>{' '}
              {conversation.escalationSummary}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onResumeAI}
            disabled={isResuming}
            className="mt-2"
          >
            <Bot className="size-3.5 mr-1.5" />
            Resume AI
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Chat View (AI conversations) ───────────────────────────────────

function ConversationChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/messaging/conversations/${conversationId}/chat`,
      }),
    [conversationId],
  );

  const { messages, sendMessage, status } = useChat({
    id: conversationId,
    transport,
    messages: initialMessages,
    onError: (error) => {
      toast.error(
        error.message ||
          'Failed to send message. Check your API key and model configuration.',
      );
    },
    onFinish: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversations'],
      });
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation', conversationId],
      });
    },
  });

  function handleSubmit(msg: PromptInputMessage) {
    if (!msg.text.trim()) return;
    sendMessage({ text: msg.text });
    setInput('');
  }

  const isStreaming = status === 'streaming' || status === 'submitted';
  const lastMessage = messages[messages.length - 1];
  const lastAssistantText =
    lastMessage?.role === 'assistant'
      ? lastMessage.parts
          .filter((p): p is TextUIPart => p.type === 'text')
          .map((p) => p.text)
          .join('')
      : '';
  const showShimmer =
    isStreaming && (lastMessage?.role === 'user' || !lastAssistantText.trim());

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="max-w-2xl mx-auto p-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                No messages yet. Start the conversation below.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                {msg.parts.map((part, partIdx) => {
                  if (part.type === 'text') {
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: multi-step agent produces multiple text parts with no unique id
                      <MessageResponse key={`${msg.id}-${partIdx}`}>
                        {part.text}
                      </MessageResponse>
                    );
                  }
                  if (isToolPart(part)) {
                    return (
                      <ToolCallPart
                        key={`${msg.id}-${part.toolCallId}`}
                        part={part}
                      />
                    );
                  }
                  return null;
                })}
              </MessageContent>
              {msg.role === 'assistant' && !isStreaming && (
                <MessageActions>
                  <MessageAction
                    label="Copy"
                    onClick={() => {
                      const text = msg.parts
                        .filter((p): p is TextUIPart => p.type === 'text')
                        .map((p) => p.text)
                        .join('');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <CopyIcon className="size-3" />
                  </MessageAction>
                </MessageActions>
              )}
            </Message>
          ))}
          {showShimmer && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-sm" duration={1.5}>
                  Thinking...
                </Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3">
        <div className="max-w-2xl mx-auto">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Type a message..."
              className="pr-12"
            />
            <PromptInputSubmit
              disabled={!input.trim() || isStreaming}
              status={isStreaming ? 'streaming' : 'ready'}
              className="absolute bottom-1 right-1"
            />
          </PromptInput>
        </div>
      </div>
    </>
  );
}

// ─── Human Reply Composer ────────────────────────────────────────────

function HumanReplyComposer({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(
        `/api/messaging/conversations/${conversationId}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      );
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation', conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversations'],
      });
      toast.success('Message sent');
    },
    onError: () => {
      toast.error('Failed to send message');
    },
  });

  return (
    <div className="border-t p-3">
      <div className="max-w-2xl mx-auto flex gap-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a reply..."
          className="min-h-[48px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (message.trim()) sendMutation.mutate(message.trim());
            }
          }}
        />
        <Button
          size="icon"
          disabled={!message.trim() || sendMutation.isPending}
          onClick={() => sendMutation.mutate(message.trim())}
          className="shrink-0 self-end"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Sidebar Section ────────────────────────────────────────────────

function SidebarSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-1.5 group">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </h3>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// ─── Right Panel (metadata sidebar) ─────────────────────────────────

function MetadataSidebar({ conversation }: { conversation: ConversationData }) {
  const queryClient = useQueryClient();

  const { data: contact } = useQuery({
    queryKey: ['messaging-contact', conversation.contactId],
    queryFn: () => fetchContact(conversation.contactId ?? ''),
    enabled: !!conversation.contactId,
  });

  const { data: allLabels = [] } = useQuery({
    queryKey: ['messaging-labels'],
    queryFn: fetchLabels,
  });

  const { data: conversationLabels = [] } = useQuery({
    queryKey: ['messaging-conversation-labels', conversation.id],
    queryFn: () => fetchConversationLabels(conversation.id),
  });

  const { data: teams = [] } = useQuery({
    queryKey: ['messaging-teams'],
    queryFn: fetchTeams,
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error('Failed to update conversation');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation', conversation.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversations'],
      });
    },
    onError: () => {
      toast.error('Failed to update conversation');
    },
  });

  const assignTeamMutation = useMutation({
    mutationFn: async (teamId: string | null) => {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId }),
        },
      );
      if (!res.ok) throw new Error('Failed to assign team');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation', conversation.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversations'],
      });
    },
    onError: () => {
      toast.error('Failed to assign team');
    },
  });

  const addLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/labels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labelId }),
        },
      );
      if (!res.ok) throw new Error('Failed to add label');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation-labels', conversation.id],
      });
    },
    onError: () => {
      toast.error('Failed to add label');
    },
  });

  const removeLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/labels/${labelId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to remove label');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation-labels', conversation.id],
      });
    },
    onError: () => {
      toast.error('Failed to remove label');
    },
  });

  const appliedLabelIds = new Set(conversationLabels.map((cl) => cl.labelId));
  const availableLabels = allLabels.filter((l) => !appliedLabelIds.has(l.id));

  return (
    <div className="w-[280px] border-l flex-col hidden lg:flex">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-1">
          {/* Contact section */}
          {contact && (
            <SidebarSection title="Contact">
              <div className="space-y-1.5 text-sm">
                {contact.name && <p className="font-medium">{contact.name}</p>}
                {contact.phone && (
                  <p className="text-xs text-muted-foreground">
                    {contact.phone}
                  </p>
                )}
                {contact.email && (
                  <p className="text-xs text-muted-foreground">
                    {contact.email}
                  </p>
                )}
              </div>
            </SidebarSection>
          )}

          {contact && <Separator className="my-2" />}

          {/* Details section */}
          <SidebarSection title="Details">
            <div className="space-y-3">
              {/* Status */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Status</p>
                <Select
                  value={conversation.status}
                  onValueChange={(value) =>
                    updateMutation.mutate({ status: value })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="snoozed">Snoozed</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Handler */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Handler</p>
                <div className="flex items-center gap-1.5 text-sm">
                  {conversation.handler === 'ai' ? (
                    <>
                      <Bot className="size-3.5 text-muted-foreground" />
                      <span>AI</span>
                    </>
                  ) : conversation.handler === 'human' ? (
                    <>
                      <User className="size-3.5 text-muted-foreground" />
                      <span>Human</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Priority</p>
                <Select
                  value={conversation.priority ?? 'low'}
                  onValueChange={(value) =>
                    updateMutation.mutate({ priority: value })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Team */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Team</p>
                {teams.length > 0 ? (
                  <Select
                    value={conversation.teamId ?? 'none'}
                    onValueChange={(value) =>
                      assignTeamMutation.mutate(value === 'none' ? null : value)
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="No team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No team</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">No team</p>
                )}
              </div>
            </div>
          </SidebarSection>

          <Separator className="my-2" />

          {/* Labels section */}
          <SidebarSection title="Labels">
            <div className="space-y-2">
              {/* Applied labels */}
              {conversationLabels.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {conversationLabels.map((cl) => (
                    <Badge
                      key={cl.labelId}
                      variant="secondary"
                      className="text-xs gap-1 pr-1"
                    >
                      {cl.label.color && (
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: cl.label.color }}
                        />
                      )}
                      {cl.label.name}
                      <button
                        type="button"
                        onClick={() => removeLabelMutation.mutate(cl.labelId)}
                        className="ml-0.5 hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {/* Add label */}
              {availableLabels.length > 0 && (
                <Select
                  value=""
                  onValueChange={(value) => addLabelMutation.mutate(value)}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Tag className="size-3" />
                      <span>Add label</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {availableLabels.map((label) => (
                      <SelectItem key={label.id} value={label.id}>
                        <div className="flex items-center gap-1.5">
                          {label.color && (
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: label.color }}
                            />
                          )}
                          {label.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {conversationLabels.length === 0 &&
                availableLabels.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No labels available
                  </p>
                )}
            </div>
          </SidebarSection>

          <Separator className="my-2" />

          {/* Timestamps section */}
          <SidebarSection title="Timestamps" defaultOpen={false}>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Created</span>
                <span>{relativeTime(conversation.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span>Updated</span>
                <span>{relativeTime(conversation.updatedAt)}</span>
              </div>
              {conversation.lastActivityAt && (
                <div className="flex justify-between">
                  <span>Last activity</span>
                  <span>{relativeTime(conversation.lastActivityAt)}</span>
                </div>
              )}
            </div>
          </SidebarSection>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────

function ConversationDetailPage() {
  const { conversationId } = useParams({
    from: '/_app/messaging/conversations/$conversationId',
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: activeConversation } = useQuery({
    queryKey: ['messaging-conversation', conversationId],
    queryFn: () => fetchConversation(conversationId),
  });

  const resumeAIMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/messaging/conversations/${conversationId}/resume-ai`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error('Failed to resume AI');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversation', conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['messaging-conversations'],
      });
      toast.success('AI resumed');
    },
    onError: () => {
      toast.error('Failed to resume AI');
    },
  });

  const initialMessages = useMemo(() => {
    return toUIMessages(activeConversation?.messages ?? []);
  }, [activeConversation?.messages]);

  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Shimmer className="text-sm text-muted-foreground">
          Loading conversation...
        </Shimmer>
      </div>
    );
  }

  const isHumanHandler = activeConversation.handler === 'human';
  const isChannelConversation = activeConversation.channel !== 'web';
  const ChannelIcon = CHANNEL_ICONS[activeConversation.channel] ?? Globe;

  return (
    <div className="flex h-full">
      {/* Center panel: messages */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-4 py-2 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 lg:hidden"
            onClick={() => navigate({ to: '/messaging/conversations' })}
          >
            <ArrowLeft className="size-4" />
          </Button>

          {/* Status dot */}
          <span
            className={cn(
              'size-2 rounded-full shrink-0',
              STATUS_COLORS[activeConversation.status] ?? 'bg-gray-400',
            )}
          />

          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-medium truncate">
              {activeConversation.title ??
                `${activeConversation.channel} conversation`}
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <ChannelIcon className="size-3" />
                <span className="capitalize">{activeConversation.channel}</span>
              </div>
              <span>·</span>
              <div className="flex items-center gap-1">
                {activeConversation.handler === 'ai' ? (
                  <Bot className="size-3" />
                ) : (
                  <User className="size-3" />
                )}
                <span className="capitalize">{activeConversation.handler}</span>
              </div>
              {activeConversation.priority &&
                activeConversation.priority !== 'low' && (
                  <>
                    <span>·</span>
                    <Badge
                      variant="secondary"
                      className="h-4 px-1 text-[9px] font-medium"
                    >
                      {activeConversation.priority}
                    </Badge>
                  </>
                )}
            </div>
          </div>
        </div>

        {/* Escalation banner */}
        <EscalationBanner
          conversation={activeConversation}
          onResumeAI={() => resumeAIMutation.mutate()}
          isResuming={resumeAIMutation.isPending}
        />

        {/* Messages + composer */}
        {isHumanHandler || isChannelConversation ? (
          <>
            <Conversation className="flex-1">
              <ConversationContent className="max-w-2xl mx-auto p-4">
                {initialMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <MessageSquare className="size-8 text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No messages yet.
                    </p>
                  </div>
                )}
                {initialMessages.map((msg) => (
                  <Message key={msg.id} from={msg.role}>
                    <MessageContent>
                      {msg.parts.map((part, partIdx) => {
                        if (part.type === 'text') {
                          return (
                            // biome-ignore lint/suspicious/noArrayIndexKey: multi-step agent produces multiple text parts with no unique id
                            <MessageResponse key={`${msg.id}-${partIdx}`}>
                              {part.text}
                            </MessageResponse>
                          );
                        }
                        return null;
                      })}
                    </MessageContent>
                  </Message>
                ))}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
            <HumanReplyComposer conversationId={conversationId} />
          </>
        ) : (
          <ConversationChat
            key={conversationId}
            conversationId={conversationId}
            initialMessages={initialMessages}
          />
        )}
      </div>

      {/* Right panel: metadata sidebar */}
      <MetadataSidebar conversation={activeConversation} />
    </div>
  );
}

export const Route = createFileRoute(
  '/_app/messaging/conversations/$conversationId',
)({
  component: ConversationDetailPage,
});
