import { memo } from 'react';

import { cn } from '@/lib/utils';

interface Reaction {
  from: string;
  emoji: string;
  action: string;
  timestamp?: string;
}

interface MessageReactionsProps {
  reactions: Reaction[];
  className?: string;
}

const EMOJI_NAMES: Record<string, string> = {
  '👍': 'thumbs up',
  '👎': 'thumbs down',
  '❤️': 'heart',
  '😂': 'laughing',
  '😮': 'surprised',
  '😢': 'crying',
  '😡': 'angry',
  '🙏': 'praying',
  '🔥': 'fire',
  '👏': 'clapping',
};

function emojiLabel(emoji: string, count: number): string {
  const name = EMOJI_NAMES[emoji] ?? 'reaction';
  return `${count} ${name} ${count === 1 ? 'reaction' : 'reactions'}`;
}

export const MessageReactions = memo(function MessageReactions({
  reactions,
  className,
}: MessageReactionsProps) {
  // Filter to only 'react' actions (dedupe by sender: last emoji per sender wins)
  const deduped = new Map<string, string>();
  for (const r of reactions) {
    if (r.action !== 'unreact') {
      deduped.set(r.from, r.emoji);
    } else {
      deduped.delete(r.from);
    }
  }

  if (deduped.size === 0) return null;

  // Group by emoji → count
  const counts = new Map<string, number>();
  for (const emoji of deduped.values()) {
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  }

  return (
    <div className={cn('flex flex-wrap gap-1 mt-1', className)}>
      {[...counts.entries()].map(([emoji, count]) => (
        <span
          key={emoji}
          role="img"
          className="inline-flex items-center gap-0.5 rounded-full border bg-muted/30 px-1.5 py-0.5 text-xs"
          aria-label={emojiLabel(emoji, count)}
        >
          {emoji}
          {count > 1 && (
            <span className="text-muted-foreground font-medium">{count}</span>
          )}
        </span>
      ))}
    </div>
  );
});
