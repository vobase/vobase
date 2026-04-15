import { memo, useMemo } from 'react';

import { ChannelBadge } from '@/components/conversation-badges';
import { CHANNEL_TAB_ALL } from '@/stores/inbox-detail-store';
import type { TimelineConversationFull } from '../../conversations/_components/types';

interface Channel {
  id: string;
  type: string;
  label: string | null;
}

interface ChannelTabBarProps {
  channels: Channel[];
  allConversations: TimelineConversationFull[];
  selectedChannelId: string | null;
  onSelectTab: (channelId: string | null) => void;
}

export const ChannelTabBar = memo(function ChannelTabBar({
  channels,
  allConversations,
  selectedChannelId,
  onSelectTab,
}: ChannelTabBarProps) {
  const sortedChannels = useMemo(() => {
    const channelActivity = new Map<string, number>();
    for (const conv of allConversations) {
      const t = new Date(conv.startedAt).getTime();
      const current = channelActivity.get(conv.channelInstanceId) ?? 0;
      if (t > current) channelActivity.set(conv.channelInstanceId, t);
    }
    return [...channels].sort(
      (a, b) =>
        (channelActivity.get(b.id) ?? 0) - (channelActivity.get(a.id) ?? 0),
    );
  }, [channels, allConversations]);

  if (channels.length <= 1) return null;

  return (
    <div className="border-b bg-background px-4">
      <div className="flex items-center gap-0.5 -mb-px">
        {sortedChannels.map((ch) => (
          <button
            key={ch.id}
            type="button"
            onClick={() => onSelectTab(ch.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              selectedChannelId === ch.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
            }`}
          >
            <ChannelBadge type={ch.type} variant="icon" />
            {ch.label ?? ch.type}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onSelectTab(CHANNEL_TAB_ALL)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            selectedChannelId === null
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
          }`}
        >
          All
        </button>
      </div>
    </div>
  );
});
