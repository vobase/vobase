import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ContactIcon, MailIcon, PhoneIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  identifier: string | null;
  createdAt: string;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchContacts(search?: string): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const res = await fetch(`/api/contacts?${params}`);
  if (!res.ok) throw new Error('Failed to fetch contacts');
  return res.json();
}

// ─── Components ───────────────────────────────────────────────────────

function roleVariant(
  role: string,
): 'default' | 'secondary' | 'outline' | 'success' {
  if (role === 'staff') return 'default';
  if (role === 'lead') return 'outline';
  return 'secondary';
}

// ─── Page ─────────────────────────────────────────────────────────────

function ContactsPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = search.length >= 2 ? search : undefined;

  const {
    data: contacts,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['contacts', debouncedSearch],
    queryFn: () => fetchContacts(debouncedSearch),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Contacts" />
      <div className="relative max-w-sm">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone or email..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no identity
            (<Skeleton key={i} className="h-12 w-full rounded-md" />)
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive py-8 text-center">
          Failed to load contacts. Please try again.
        </p>
      )}
      {contacts && contacts.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ContactIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {debouncedSearch
              ? 'No contacts match your search.'
              : 'No contacts yet.'}
          </p>
        </div>
      )}
      {contacts && contacts.length > 0 && (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Phone
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Role
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b last:border-0 transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/contacts/$contactId"
                      params={{ contactId: contact.id }}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {contact.name ?? contact.identifier ?? contact.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {contact.phone ? (
                      <span className="flex items-center gap-1.5">
                        <PhoneIcon className="h-3.5 w-3.5 shrink-0" />
                        {contact.phone}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {contact.email ? (
                      <span className="flex items-center gap-1.5">
                        <MailIcon className="h-3.5 w-3.5 shrink-0" />
                        {contact.email}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={roleVariant(contact.role)}
                      className="capitalize text-xs"
                    >
                      {contact.role}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_app/contacts/contacts')({
  component: ContactsPage,
});
