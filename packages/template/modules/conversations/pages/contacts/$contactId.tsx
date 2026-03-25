import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  MailIcon,
  PhoneIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

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
  channel: string;
  status: string;
  createdAt: string;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await globalThis.fetch(`/api/conversations/contacts/${id}`);
  if (!res.ok) throw new Error('Contact not found');
  return res.json();
}

async function fetchContactSessions(contactId: string): Promise<Session[]> {
  const res = await globalThis.fetch(
    `/api/conversations/sessions?contactId=${contactId}`,
  );
  if (!res.ok) return [];
  return res.json();
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

function roleVariant(
  role: string,
): 'default' | 'secondary' | 'outline' | 'success' {
  if (role === 'staff') return 'default';
  if (role === 'lead') return 'outline';
  return 'secondary';
}

// ─── Page ─────────────────────────────────────────────────────────────

function ContactDetailPage() {
  const { contactId } = Route.useParams();

  const {
    data: contact,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => fetchContact(contactId),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['conversations-sessions', { contactId }],
    queryFn: () => fetchContactSessions(contactId),
    enabled: !!contact,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !contact) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Contact not found.</p>
        <Link
          to="/contacts"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to contacts
        </Link>
      </div>
    );
  }

  const displayName = contact.name ?? contact.identifier ?? contact.id;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to="/contacts"
          className="hover:text-foreground transition-colors"
        >
          Contacts
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{displayName}</span>
      </div>

      {/* Contact info */}
      <div className="rounded-md border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{displayName}</h2>
          <Badge
            variant={roleVariant(contact.role)}
            className="capitalize text-xs"
          >
            {contact.role}
          </Badge>
        </div>

        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          {contact.phone && (
            <div className="flex items-center gap-2">
              <PhoneIcon className="h-3.5 w-3.5 shrink-0" />
              {contact.phone}
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-2">
              <MailIcon className="h-3.5 w-3.5 shrink-0" />
              {contact.email}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Added {new Date(contact.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Session history */}
      <div>
        <h3 className="mb-3 text-sm font-medium">Session History</h3>

        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    Channel
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    Agent
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 capitalize">{session.channel}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {session.agentId ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={statusVariant(session.status)}
                        className="capitalize text-xs"
                      >
                        {session.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/contacts/$contactId')({
  component: ContactDetailPage,
});
