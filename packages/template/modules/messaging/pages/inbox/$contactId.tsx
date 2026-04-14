import { createFileRoute, Link } from '@tanstack/react-router';
import { parseAsString, useQueryState } from 'nuqs';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth-client';
import { useInboxDetailStore } from '@/stores/inbox-detail-store';
import { BlockView } from './_components/block-view';
import { ChannelTabBar } from './_components/channel-tab-bar';
import { FlatTimeline } from './_components/flat-timeline';
import { InboxSidebar } from './_components/inbox-sidebar';
import {
  markContactRead,
  useInboxMutations,
} from './_hooks/use-inbox-mutations';
import { useInboxTimeline } from './_hooks/use-inbox-timeline';

// ─── Page ─────────────────────────────────────────────────────────────

function InboxDetailPage() {
  const { contactId } = Route.useParams() as { contactId: string };
  const { data: session } = authClient.useSession();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('inbox-sidebar') === 'open',
  );
  useEffect(() => {
    localStorage.setItem('inbox-sidebar', sidebarOpen ? 'open' : 'closed');
  }, [sidebarOpen]);

  // ── URL state (nuqs) ───────────────────────────────────────────────
  const [channel, setChannel] = useQueryState(
    'channel',
    parseAsString.withOptions({ history: 'replace' }),
  );
  const [conversation, setConversation] = useQueryState(
    'conversation',
    parseAsString.withOptions({ history: 'replace' }),
  );

  // ── Zustand store (individual selectors) ──────────────────────────
  const expandedConversationIds = useInboxDetailStore(
    (s) => s.expandedConversationIds,
  );
  const toggleBlock = useInboxDetailStore((s) => s.toggleBlock);
  const setDefaultExpansion = useInboxDetailStore((s) => s.setDefaultExpansion);
  const expandBlock = useInboxDetailStore((s) => s.expandBlock);
  const switchContact = useInboxDetailStore((s) => s.switchContact);
  const storeContactId = useInboxDetailStore((s) => s.contactId);

  // Switch contact atomically when URL changes
  useEffect(() => {
    if (storeContactId !== contactId) {
      switchContact(contactId);
    }
  }, [contactId, storeContactId, switchContact]);

  // ── Extracted hooks ───────────────────────────────────────────────
  const {
    contact,
    contactLoading,
    contactError,
    allMessages,
    allConversations,
    channels,
    sortedConversations,
    filteredConversations,
    messagesByConversation,
    activeChannelConversation,
    channelFlatMessages,
    conversationBoundaries,
    selectedChannel,
    senderMap,
    hasNextPage,
    agents,
  } = useInboxTimeline(contactId, channel, session);

  const {
    replyMutation,
    updateConversationMutation,
    newConversationMutation,
    retryMutation,
  } = useInboxMutations(contactId);

  // ── Auto-select first channel tab ─────────────────────────────────
  const autoSelectedTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (channels.length > 0 && autoSelectedTabRef.current !== contactId) {
      autoSelectedTabRef.current = contactId;
      const channelActivity = new Map<string, number>();
      for (const conv of allConversations) {
        const t = new Date(conv.startedAt).getTime();
        const current = channelActivity.get(conv.channelInstanceId) ?? 0;
        if (t > current) channelActivity.set(conv.channelInstanceId, t);
      }
      const sorted = [...channels].sort(
        (a, b) =>
          (channelActivity.get(b.id) ?? 0) - (channelActivity.get(a.id) ?? 0),
      );
      setChannel(sorted[0]?.id ?? null);
    }
  }, [channels, contactId, allConversations, setChannel]);

  // ── Scroll to bottom on channel tab switch ─────────────────────────
  const channelScrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on tab switch / new messages
  useEffect(() => {
    if (channelScrollRef.current && channel) {
      channelScrollRef.current.scrollTop =
        channelScrollRef.current.scrollHeight;
    }
  }, [channel, channelFlatMessages.length]);

  // ── Effects ────────────────────────────────────────────────────────

  // Set default expansion once per contact when conversations first load
  const defaultExpansionContactRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      allConversations.length > 0 &&
      defaultExpansionContactRef.current !== contactId
    ) {
      defaultExpansionContactRef.current = contactId;
      setDefaultExpansion(allConversations);
    }
  }, [allConversations, contactId, setDefaultExpansion]);

  // Scroll to first active block on initial load (threads view)
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (hasScrolledRef.current || sortedConversations.length === 0) return;
    hasScrolledRef.current = true;
    const firstActive = sortedConversations.find((i) => i.status === 'active');
    if (!firstActive) return;
    const el = document.getElementById(`block-${firstActive.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sortedConversations]);

  // ── Deep-link to specific conversation via ?conversation= param ────
  const conversationScrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversation || conversationScrolledRef.current === conversation)
      return;
    if (sortedConversations.length === 0) return;
    const el = document.getElementById(`block-${conversation}`);
    if (el) {
      conversationScrolledRef.current = conversation;
      expandBlock(conversation);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setConversation(null);
    }
  }, [conversation, sortedConversations, expandBlock, setConversation]);

  // Mark contact as read
  const lastMsgId = allMessages[allMessages.length - 1]?.id;
  const hasMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastMsgId || hasMarkedRef.current === lastMsgId) return;
    hasMarkedRef.current = lastMsgId;
    markContactRead(contactId).catch(() => {});
  }, [contactId, lastMsgId]);

  // ── Sidebar visible block tracking ────────────────────────────────
  const [visibleBlockId, setVisibleBlockId] = useState<string | null>(null);
  useEffect(() => {
    if (sortedConversations.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-block-id');
            if (id) setVisibleBlockId(id);
          }
        }
      },
      { threshold: 0.3 },
    );
    for (const conv of sortedConversations) {
      const el = document.getElementById(`block-${conv.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sortedConversations]);

  const scrollToBlock = useCallback((conversationId: string) => {
    document
      .getElementById(`block-${conversationId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Hard error
  if (contactError && !contact) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Contact not found</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Main panel ─── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Contact header */}
        <div className="border-b bg-background px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {contact ? (
                <>
                  <h1 className="text-base font-semibold truncate">
                    {contact.name ??
                      contact.phone ??
                      contact.email ??
                      'Unknown'}
                  </h1>
                  {contact.phone && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {contact.phone}
                    </span>
                  )}
                  {contact.email && !contact.phone && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {contact.email}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Skeleton className="h-[1.5rem] w-32 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {contact && (
                <Link
                  to="/messaging/contacts/$contactId"
                  params={{ contactId: contact.id }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Profile
                </Link>
              )}
            </div>
          </div>
        </div>

        <ChannelTabBar
          channels={channels}
          allConversations={allConversations}
          selectedChannelId={channel}
          onSelectTab={setChannel}
        />

        {/* ─── Content area ─── */}
        {channel ? (
          <FlatTimeline
            channelFlatMessages={channelFlatMessages}
            conversationBoundaries={conversationBoundaries}
            filteredConversations={filteredConversations}
            activeChannelConversation={activeChannelConversation}
            selectedChannel={selectedChannel}
            channelId={channel}
            senderMap={senderMap}
            currentUserId={session?.user?.id}
            agents={agents}
            contactLoading={contactLoading}
            scrollRef={channelScrollRef}
            onReply={(convId, content, isInternal) =>
              replyMutation.mutate({
                conversationId: convId,
                content,
                isInternal,
              })
            }
            onNewConversation={(channelInstanceId, content, isInternal) =>
              newConversationMutation.mutate({
                channelInstanceId,
                content,
                isInternal,
              })
            }
            onRetry={(convId, messageId) =>
              retryMutation.mutate({
                conversationId: convId,
                messageId,
              })
            }
            onUpdateConversation={(id, body) =>
              updateConversationMutation.mutate({ id, body })
            }
            replyPending={replyMutation.isPending}
            replyError={replyMutation.isError}
            newConversationPending={newConversationMutation.isPending}
            newConversationError={newConversationMutation.isError}
          />
        ) : (
          <BlockView
            sortedConversations={sortedConversations}
            allConversations={allConversations}
            messagesByConversation={messagesByConversation}
            senderMap={senderMap}
            expandedConversationIds={expandedConversationIds}
            currentUserId={session?.user?.id}
            agents={agents}
            contactLoading={contactLoading}
            onToggleBlock={toggleBlock}
            onUpdateConversation={(convId, body) =>
              updateConversationMutation.mutate({ id: convId, body })
            }
            onRetry={(convId, messageId) =>
              retryMutation.mutate({
                conversationId: convId,
                messageId,
              })
            }
          />
        )}
      </div>

      <InboxSidebar
        contactId={contactId}
        contact={contact}
        allConversations={allConversations}
        sortedConversations={sortedConversations}
        channels={channels}
        allMessagesCount={allMessages.length}
        hasNextPage={hasNextPage}
        visibleBlockId={visibleBlockId}
        sidebarOpen={sidebarOpen}
        onSetSidebarOpen={setSidebarOpen}
        onScrollToBlock={scrollToBlock}
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/inbox/$contactId')({
  component: InboxDetailPage,
});
