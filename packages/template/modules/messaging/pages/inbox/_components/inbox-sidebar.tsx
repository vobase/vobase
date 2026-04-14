import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  PanelRightIcon,
  PlusIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';
import { memo } from 'react';

import { ChannelBadge } from '@/components/conversation-badges';
import { Badge } from '@/components/ui/badge';
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
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { messagingClient } from '@/lib/api-client';
import type { TimelineConversationFull } from '../../conversations/_components/types';

// ─── Types ────────────────────────────────────────────────────────────

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

// ─── Contact Labels (self-contained sub-component) ───────────────────

function ContactLabelsSection({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const { data: contactLabels = [] } = useQuery({
    queryKey: ['contact-labels', contactId],
    queryFn: async () => {
      const res = await messagingClient.contacts[':id'].labels.$get({
        param: { id: contactId },
      });
      if (!res.ok) return [];
      return res.json() as Promise<ContactLabel[]>;
    },
  });

  const { data: allLabels = [] } = useQuery({
    queryKey: ['labels'],
    queryFn: async () => {
      const res = await messagingClient.labels.$get();
      if (!res.ok) return [];
      return res.json() as Promise<
        { id: string; title: string; color: string | null }[]
      >;
    },
    staleTime: 60000,
  });

  const addMutation = useMutation({
    mutationFn: (labelIds: string[]) =>
      messagingClient.contacts[':id'].labels.$post(
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
      messagingClient.contacts[':id'].labels[':labelId'].$delete({
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

// ─── Sidebar ─────────────────────────────────────────────────────────

interface InboxSidebarProps {
  contactId: string;
  contact: Contact | undefined;
  allConversations: TimelineConversationFull[];
  sortedConversations: TimelineConversationFull[];
  channels: Array<{ id: string; type: string; label: string | null }>;
  allMessagesCount: number;
  hasNextPage: boolean | undefined;
  visibleBlockId: string | null;
  sidebarOpen: boolean;
  onSetSidebarOpen: (open: boolean) => void;
  onScrollToBlock: (conversationId: string) => void;
}

export const InboxSidebar = memo(function InboxSidebar({
  contactId,
  contact,
  allConversations,
  sortedConversations,
  channels,
  allMessagesCount,
  hasNextPage,
  visibleBlockId,
  sidebarOpen,
  onSetSidebarOpen,
  onScrollToBlock,
}: InboxSidebarProps) {
  return (
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
          onClick={() => onSetSidebarOpen(true)}
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
              onClick={() => onSetSidebarOpen(false)}
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

              {/* Conversations list */}
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between group">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Conversations ({allConversations.length})
                  </p>
                  <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-1">
                  {sortedConversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => onScrollToBlock(conv.id)}
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        conv.id === visibleBlockId
                          ? 'bg-primary/10'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <ChannelBadge type={conv.channelType} variant="icon" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              conv.status === 'active'
                                ? 'default'
                                : conv.status === 'failed'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                            className="h-4 px-1 text-[10px]"
                          >
                            {conv.status}
                          </Badge>
                        </div>
                      </div>
                      <RelativeTimeCard
                        asChild
                        date={conv.startedAt}
                        className="text-[10px] text-muted-foreground shrink-0"
                      />
                    </button>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              <Separator />

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
                    {String(allMessagesCount)}
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
  );
});
