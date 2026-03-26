import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BrainIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  LayersIcon,
  MailIcon,
  PhoneIcon,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient, conversationsClient } from '@/lib/api-client';

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

interface Session {
  id: string;
  agentId: string | null;
  channelInstanceId: string;
  sessionType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

interface MemoryStats {
  cells: number;
  episodes: number;
  facts: number;
}

interface MemoryEpisode {
  id: string;
  content: string;
  timestamp?: string;
  createdAt: string;
}

interface MemoryFact {
  id: string;
  content: string;
  createdAt: string;
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await conversationsClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) throw new Error('Contact not found');
  return res.json() as unknown as Promise<Contact>;
}

async function fetchContactSessions(contactId: string): Promise<Session[]> {
  const res = await conversationsClient.sessions.$get({ query: { contactId } });
  if (!res.ok) return [];
  return res.json() as unknown as Promise<Session[]>;
}

async function fetchMemoryStats(contactId: string): Promise<MemoryStats> {
  const res = await aiClient.memory.stats.$get({
    query: { scope: `contact:${contactId}` },
  });
  if (!res.ok) return { cells: 0, episodes: 0, facts: 0 };
  return res.json();
}

async function fetchMemoryEpisodes(
  contactId: string,
): Promise<MemoryEpisode[]> {
  const res = await aiClient.memory.episodes.$get({
    query: { scope: `contact:${contactId}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown as { episodes?: MemoryEpisode[] };
  return data.episodes ?? [];
}

async function fetchMemoryFacts(contactId: string): Promise<MemoryFact[]> {
  const res = await aiClient.memory.facts.$get({
    query: { scope: `contact:${contactId}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown as {
    facts?: Array<{ id: string; fact: string; createdAt: string }>;
  };
  return (data.facts ?? []).map((f) => ({
    id: f.id,
    content: f.fact,
    createdAt: f.createdAt,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'destructive';
  return 'secondary';
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

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Tab = 'overview' | 'sessions' | 'memory';

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
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  Metadata
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {metaEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-md bg-muted/50 px-2.5 py-1.5"
                    >
                      <p className="text-[10px] text-muted-foreground">{key}</p>
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

// ─── Sessions Tab ────────────────────────────────────────────────────

function SessionsTab({ contactId }: { contactId: string }) {
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['conversations-sessions', { contactId }],
    queryFn: () => fetchContactSessions(contactId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 py-8 text-center">
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              AI Agent
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Type
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Started
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id}
              className="border-b last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-3 py-2.5">
                <Badge
                  variant={statusVariant(session.status)}
                  className="capitalize text-[10px]"
                >
                  {session.status}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground text-xs">
                {session.agentId ?? '—'}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground text-xs capitalize">
                {session.sessionType}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground text-xs">
                {formatDateTime(session.startedAt)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link
                  to="/conversations/sessions/$sessionId"
                  params={{ sessionId: session.id }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Memory Tab ──────────────────────────────────────────────────────

function MemoryTab({ contactId }: { contactId: string }) {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['memory-stats', `contact:${contactId}`],
    queryFn: () => fetchMemoryStats(contactId),
  });

  const { data: episodes = [] } = useQuery({
    queryKey: ['memory-episodes', `contact:${contactId}`],
    queryFn: () => fetchMemoryEpisodes(contactId),
  });

  const { data: facts = [] } = useQuery({
    queryKey: ['memory-facts', `contact:${contactId}`],
    queryFn: () => fetchMemoryFacts(contactId),
  });

  const statCards = [
    { label: 'Facts', value: stats?.facts ?? 0, icon: BrainIcon },
    { label: 'Episodes', value: stats?.episodes ?? 0, icon: BookOpenIcon },
    { label: 'Cells', value: stats?.cells ?? 0, icon: LayersIcon },
  ];

  const isEmpty =
    !statsLoading &&
    (stats?.facts ?? 0) + (stats?.episodes ?? 0) + (stats?.cells ?? 0) === 0;

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-3 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <card.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                {statsLoading ? (
                  <Skeleton className="h-5 w-8 mb-0.5" />
                ) : (
                  <p className="text-lg font-semibold leading-none">
                    {card.value}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {card.label}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isEmpty && (
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

      {/* Facts */}
      {facts.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Facts ({facts.length})
          </h4>
          <div className="space-y-1.5">
            {facts.map((fact) => (
              <div
                key={fact.id}
                className="flex items-start gap-2.5 rounded-md border bg-card px-3 py-2"
              >
                <BrainIcon className="h-3.5 w-3.5 text-primary/60 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">{fact.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {formatDateTime(fact.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Episodes */}
      {episodes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Episodes ({episodes.length})
          </h4>
          <div className="space-y-1.5">
            {episodes.map((episode) => (
              <div
                key={episode.id}
                className="flex items-start gap-2.5 rounded-md border bg-card px-3 py-2"
              >
                <ClockIcon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">{episode.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {formatDateTime(episode.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link to full memory explorer */}
      {!isEmpty && (
        <div className="pt-2">
          <Link
            to="/conversations/ai/memory"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Open full memory explorer &rarr;
          </Link>
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
          to="/conversations/contacts"
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
    { id: 'sessions', label: 'Conversations' },
    { id: 'memory', label: 'Memory' },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to="/conversations/contacts"
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
      {activeTab === 'sessions' && <SessionsTab contactId={contact.id} />}
      {activeTab === 'memory' && <MemoryTab contactId={contact.id} />}
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/contacts/$contactId')(
  {
    component: ContactDetailPage,
  },
);
