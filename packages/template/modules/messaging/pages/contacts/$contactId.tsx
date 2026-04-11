import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  BrainIcon,
  CalendarIcon,
  ChevronRightIcon,
  GlobeIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  SmartphoneIcon,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { agentsClient, messagingClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  identifier: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface TimelineConversation {
  id: string;
  status: string;
  outcome: string | null;
  reopenCount: number;
  onHold: boolean;
  priority: number | null;
  assignee: string | null;
  channelInstanceId: string;
  channelType: string;
  channelLabel: string;
  startedAt: string;
  resolvedAt: string | null;
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await messagingClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) throw new Error('Contact not found');
  return res.json() as unknown as Promise<Contact>;
}

async function fetchContactTimeline(
  contactId: string,
): Promise<TimelineConversation[]> {
  const res = await messagingClient.contacts[':id'].timeline.$get({
    param: { id: contactId },
    query: { limit: '50' },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown as {
    conversations: TimelineConversation[];
  };
  return data.conversations;
}

async function fetchWorkingMemory(contactId: string): Promise<string | null> {
  const res = await agentsClient.memory.working.$get({
    query: { scope: `contact:${contactId}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as unknown as {
    workingMemory: string | null;
  };
  return data.workingMemory ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'resolved') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'resolving') return 'outline';
  return 'secondary';
}

const CHANNEL_CONFIG: Record<
  string,
  { icon: typeof GlobeIcon; color: string; bg: string }
> = {
  whatsapp: {
    icon: SmartphoneIcon,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
  },
  email: {
    icon: MailIcon,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  web: {
    icon: GlobeIcon,
    color: 'text-muted-foreground',
    bg: 'bg-muted',
  },
};

function getChannelConfig(type: string) {
  return (
    CHANNEL_CONFIG[type] ?? {
      icon: MessageSquareIcon,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
    }
  );
}

function roleVariant(role: string): 'default' | 'secondary' | 'outline' {
  if (role === 'staff') return 'default';
  if (role === 'lead') return 'outline';
  return 'secondary';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type Tab = 'overview' | 'timeline' | 'memory';

// ─── Overview Tab ────────────────────────────────────────────────────

function OverviewTab({ contact }: { contact: Contact }) {
  const metaEntries = Object.entries(contact.metadata ?? {}).filter(
    ([, v]) => v != null && v !== '',
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          {/* Identity */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <UserIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-semibold">
                  {contact.name ?? contact.identifier ?? contact.id}
                </h3>
                {contact.identifier && contact.name && (
                  <p className="text-xs text-muted-foreground">
                    {contact.identifier}
                  </p>
                )}
              </div>
            </div>
            <Badge variant={roleVariant(contact.role)} className="capitalize">
              {contact.role}
            </Badge>
          </div>

          <Separator />

          {/* Contact info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {contact.phone && (
              <div className="flex items-center gap-2.5 text-sm">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                  <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span>{contact.phone}</span>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2.5 text-sm">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                  <MailIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span>{contact.email}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span>Added {formatDate(contact.createdAt)}</span>
            </div>
          </div>

          {/* Metadata */}
          {metaEntries.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  Metadata
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {metaEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-md bg-muted/50 px-2.5 py-1.5"
                    >
                      <p className="text-xs text-muted-foreground">{key}</p>
                      <p className="text-xs font-medium truncate">
                        {String(value)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Timeline Tab ───────────────────────────────────────────────────

function TimelineTab({ contactId }: { contactId: string }) {
  const { data: timeline = [], isLoading } = useQuery({
    queryKey: ['contacts-timeline', contactId],
    queryFn: () => fetchContactTimeline(contactId),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {['t1', 't2', 't3'].map((k) => (
          <Skeleton key={k} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 py-8 text-center">
        <MessageSquareIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {timeline.map((conv) => (
        <ConversationCard
          key={conv.id}
          conversation={conv}
          contactId={contactId}
        />
      ))}
    </div>
  );
}

function ConversationCard({
  conversation,
  contactId,
}: {
  conversation: TimelineConversation;
  contactId: string;
}) {
  const channel = getChannelConfig(conversation.channelType);
  const ChannelIcon = channel.icon;
  const duration = conversation.resolvedAt
    ? formatDuration(conversation.startedAt, conversation.resolvedAt)
    : null;

  return (
    <div className="group rounded-lg border bg-background transition-colors hover:bg-muted/20">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Channel icon */}
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${channel.bg}`}
        >
          <ChannelIcon className={`h-3.5 w-3.5 ${channel.color}`} />
        </div>

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {`${conversation.channelLabel} conversation`}
            </span>
            {conversation.reopenCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                reopened {conversation.reopenCount}x
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{formatDateTime(conversation.startedAt)}</span>
            {duration && (
              <>
                <span>&middot;</span>
                <span>{duration}</span>
              </>
            )}
            <span>&middot;</span>
            <span className="capitalize">{conversation.channelType}</span>
          </div>
        </div>

        {/* Right side: badges */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge
            variant={statusVariant(conversation.status)}
            className="text-[10px] capitalize"
          >
            {conversation.status}
          </Badge>
          {conversation.outcome && conversation.status === 'resolved' && (
            <Badge variant="secondary" className="text-[10px] capitalize">
              {conversation.outcome.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end border-t px-4 py-2 text-[11px] text-muted-foreground">
        <Link
          to="/messaging/inbox/$contactId"
          params={{ contactId }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        >
          Open &rarr;
        </Link>
      </div>
    </div>
  );
}

function formatDuration(startStr: string, endStr: string): string {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

// ─── Memory Tab ──────────────────────────────────────────────────────

function MemoryTab({ contactId }: { contactId: string }) {
  const { data: workingMemory, isLoading } = useQuery({
    queryKey: ['memory-working', `contact:${contactId}`],
    queryFn: () => fetchWorkingMemory(contactId),
  });

  return (
    <div className="space-y-5">
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {!isLoading && !workingMemory && (
        <div className="rounded-lg border bg-muted/20 py-8 text-center">
          <BrainIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            No memory data for this contact yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Memory is built from conversations with AI agents.
          </p>
        </div>
      )}

      {workingMemory && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Working Memory
          </h4>
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 mb-2">
                <BrainIcon className="h-3.5 w-3.5 text-primary/60" />
                <span className="text-xs text-muted-foreground">
                  Agent's live context for this contact
                </span>
              </div>
              <div className="text-xs text-foreground leading-relaxed bg-muted/50 rounded-md p-2.5 overflow-auto max-h-64 [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:my-0 [&_strong]:font-medium [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded">
                <Markdown remarkPlugins={[remarkGfm]}>{workingMemory}</Markdown>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function ContactDetailPage() {
  const { contactId } = Route.useParams();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const {
    data: contact,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => fetchContact(contactId),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !contact) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Contact not found.</p>
        <Link
          to="/messaging/contacts"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to contacts
        </Link>
      </div>
    );
  }

  const displayName = contact.name ?? contact.identifier ?? contact.id;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'memory', label: 'Memory' },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to="/messaging/contacts"
          className="hover:text-foreground transition-colors"
        >
          Contacts
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{displayName}</span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant="ghost"
            size="sm"
            className={`rounded-none border-b-2 px-3 text-sm ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab contact={contact} />}
      {activeTab === 'timeline' && <TimelineTab contactId={contact.id} />}
      {activeTab === 'memory' && <MemoryTab contactId={contact.id} />}
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/contacts/$contactId')({
  component: ContactDetailPage,
});
