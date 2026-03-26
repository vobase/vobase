import { useQuery } from '@tanstack/react-query';
import {
  CheckIcon,
  ChevronsUpDownIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  channel: string | null;
}

async function fetchContacts(): Promise<Contact[]> {
  const res = await globalThis.fetch('/api/conversations/contacts');
  if (!res.ok) throw new Error('Failed to fetch contacts');
  return res.json();
}

export function MemoryScopeSelector({
  scope,
  onScopeChange,
  userId,
}: {
  scope: string;
  onScopeChange: (scope: string) => void;
  userId: string;
}) {
  const [open, setOpen] = useState(false);

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts'],
    queryFn: fetchContacts,
  });

  const userScope = `user:${userId}`;
  const isUserScope = scope === userScope;

  const selectedContact = !isUserScope
    ? contacts.find((c) => `contact:${c.id}` === scope)
    : null;

  const label = isUserScope
    ? 'My memory'
    : (selectedContact?.name ??
      selectedContact?.phone ??
      selectedContact?.email ??
      'Unknown contact');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 min-w-[200px] justify-between"
        >
          <span className="flex items-center gap-2 truncate">
            {isUserScope ? (
              <UserIcon className="size-3.5 shrink-0" />
            ) : (
              <UsersIcon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search contacts..." />
          <CommandList>
            <CommandEmpty>No contacts found.</CommandEmpty>
            <CommandGroup heading="Scope">
              <CommandItem
                value="my-conversations"
                onSelect={() => {
                  onScopeChange(userScope);
                  setOpen(false);
                }}
              >
                <UserIcon className="size-3.5" />
                <span>My memory</span>
                {isUserScope && <CheckIcon className="ml-auto size-3.5" />}
              </CommandItem>
            </CommandGroup>
            {contacts.length > 0 && (
              <CommandGroup heading="Contacts">
                {contacts.map((contact) => {
                  const contactScope = `contact:${contact.id}`;
                  const isSelected = scope === contactScope;
                  const displayName =
                    contact.name ?? contact.phone ?? contact.email ?? 'Unknown';

                  return (
                    <CommandItem
                      key={contact.id}
                      value={`${displayName} ${contact.phone ?? ''} ${contact.email ?? ''}`}
                      onSelect={() => {
                        onScopeChange(contactScope);
                        setOpen(false);
                      }}
                    >
                      <UsersIcon className="size-3.5" />
                      <span className="truncate">{displayName}</span>
                      {contact.channel && (
                        <Badge
                          variant="outline"
                          className="ml-auto text-[10px] capitalize shrink-0"
                        >
                          {contact.channel}
                        </Badge>
                      )}
                      {isSelected && !contact.channel && (
                        <CheckIcon className="ml-auto size-3.5" />
                      )}
                      {isSelected && contact.channel && (
                        <CheckIcon className="size-3.5 shrink-0" />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
