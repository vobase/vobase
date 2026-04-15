import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { agentsClient, messagingClient } from '@/lib/api-client';
import { extractStaffName } from '@/lib/normalize-message';
import { CHANNEL_TAB_ALL } from '@/stores/inbox-detail-store';
import type {
  MessageRow,
  SenderInfo,
  TimelineConversationFull,
} from '../../conversations/_components/types';

// ─── Types ────────────────────────────────────────────────────────────

interface TimelinePage {
  messages: MessageRow[];
  hasMore: boolean;
  nextCursor?: string | null;
  conversations: TimelineConversationFull[];
  channels: { id: string; type: string; label: string | null }[];
}

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
}

interface AgentInfo {
  id: string;
  name: string;
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await messagingClient.contacts[':id'].$get({ param: { id } });
  if (!res.ok) throw new Error('Contact not found');
  return res.json() as Promise<Contact>;
}

async function fetchTimelinePage(
  contactId: string,
  before?: string,
): Promise<TimelinePage> {
  const query: { limit: string; before?: string } = { limit: '50' };
  if (before) query.before = before;
  const res = await messagingClient.contacts[':id'].timeline.$get({
    param: { id: contactId },
    query,
  });
  if (!res.ok)
    return { messages: [], hasMore: false, conversations: [], channels: [] };
  const data = await res.json();
  return data as unknown as TimelinePage;
}

async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await agentsClient.agents.$get();
  if (!res.ok) return [];
  return res.json() as Promise<AgentInfo[]>;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useInboxTimeline(
  contactId: string,
  channelTabOverride: string | null,
  session: {
    user?: { id: string; name?: string; email: string; image?: string | null };
  } | null,
) {
  // ── Queries ──
  const {
    data: contact,
    isLoading: contactLoading,
    isError: contactError,
  } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => fetchContact(contactId),
  });

  const { data: timelineData, hasNextPage } = useInfiniteQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchTimelinePage(contactId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (firstPage) => firstPage.nextCursor ?? undefined,
    enabled: !!contact,
    placeholderData: keepPreviousData,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // ── Derived data (11 useMemo) ──

  const allMessages = useMemo(
    () => timelineData?.pages.flatMap((p) => p.messages) ?? [],
    [timelineData],
  );

  const allConversations = useMemo(
    () => timelineData?.pages[0]?.conversations ?? [],
    [timelineData],
  );

  const channels = useMemo(
    () => timelineData?.pages[0]?.channels ?? [],
    [timelineData],
  );

  // Resolve effective channel: validate override against current channels,
  // fall back to single channel or most recently active.
  // channelTabOverride values:
  //   null  = no user selection yet → auto-select
  //   CHANNEL_TAB_ALL = user explicitly chose "All" tab → null (show all)
  //   string = user chose a specific channel
  const selectedTabChannelId = useMemo(() => {
    if (channels.length === 0) return null;
    if (channelTabOverride === CHANNEL_TAB_ALL) return null;
    if (channelTabOverride && channels.some((c) => c.id === channelTabOverride))
      return channelTabOverride;
    if (channels.length === 1) return channels[0].id;
    // Multi-channel, no valid override — pick most recently active
    const activity = new Map<string, number>();
    for (const conv of allConversations) {
      const t = new Date(conv.startedAt).getTime();
      const cur = activity.get(conv.channelInstanceId) ?? 0;
      if (t > cur) activity.set(conv.channelInstanceId, t);
    }
    const sorted = [...channels].sort(
      (a, b) => (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0),
    );
    return sorted[0]?.id ?? null;
  }, [channelTabOverride, channels, allConversations]);

  const sortedConversations = useMemo(
    () =>
      [...allConversations].sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [allConversations],
  );

  const filteredConversations = useMemo(() => {
    if (!selectedTabChannelId) return sortedConversations;
    return sortedConversations.filter(
      (i) => i.channelInstanceId === selectedTabChannelId,
    );
  }, [sortedConversations, selectedTabChannelId]);

  const messagesByConversation = useMemo(() => {
    const map = new Map<string, MessageRow[]>();
    for (const msg of allMessages) {
      const list = map.get(msg.conversationId) ?? [];
      list.push(msg);
      map.set(msg.conversationId, list);
    }
    return map;
  }, [allMessages]);

  const activeChannelConversation = useMemo(() => {
    if (!selectedTabChannelId) return null;
    return (
      filteredConversations.find(
        (i) => i.status === 'active' || i.status === 'resolving',
      ) ?? null
    );
  }, [filteredConversations, selectedTabChannelId]);

  const channelFlatMessages = useMemo(() => {
    if (!selectedTabChannelId) return [];
    const msgs: Array<MessageRow & { _conversationId: string }> = [];
    for (const conv of filteredConversations) {
      const conversationMsgs = messagesByConversation.get(conv.id) ?? [];
      for (const msg of conversationMsgs) {
        msgs.push({ ...msg, _conversationId: conv.id });
      }
    }
    return msgs.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [selectedTabChannelId, filteredConversations, messagesByConversation]);

  const conversationBoundaries = useMemo(() => {
    const boundaries = new Set<string>();
    let lastConversationId: string | null = null;
    for (const msg of channelFlatMessages) {
      if (lastConversationId && msg._conversationId !== lastConversationId) {
        boundaries.add(msg.id);
      }
      lastConversationId = msg._conversationId;
    }
    return boundaries;
  }, [channelFlatMessages]);

  const selectedChannel = useMemo(
    () =>
      channels.find((c) => c.id === selectedTabChannelId) ??
      channels[0] ??
      null,
    [channels, selectedTabChannelId],
  );

  const senderMap = useMemo(() => {
    const map = new Map<string, SenderInfo>();
    if (session?.user) {
      map.set(session.user.id, {
        name: session.user.name ?? session.user.email,
        image: session.user.image,
      });
    }
    if (contact) {
      map.set(contactId, {
        name: contact.name ?? contact.phone ?? 'Customer',
      });
    }
    for (const agent of agents) {
      map.set(agent.id, { name: agent.name });
    }
    for (const msg of allMessages) {
      if (msg.senderType === 'user' && !map.has(msg.senderId)) {
        const name = extractStaffName(msg.content);
        if (name) map.set(msg.senderId, { name });
      }
    }
    return map;
  }, [session, contact, contactId, agents, allMessages]);

  return {
    contact,
    contactLoading,
    contactError,
    allMessages,
    allConversations,
    channels,
    effectiveChannelId: selectedTabChannelId,
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
  };
}
