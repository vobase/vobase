import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  BookOpenIcon,
  BrainIcon,
  ClockIcon,
  LayersIcon,
  SearchIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth-client';
import { MemoryScopeSelector } from './-memory-scope-selector';
import { MemorySearchView } from './-memory-search-view';
import { MemoryTimeline } from './-memory-timeline';

interface MemoryStats {
  cells: number;
  episodes: number;
  facts: number;
}

async function fetchStats(scope: string): Promise<MemoryStats> {
  const res = await globalThis.fetch(
    `/api/ai/memory/stats?${new URLSearchParams({ scope })}`,
  );
  if (!res.ok) throw new Error('Failed to fetch memory stats');
  return res.json();
}

type ViewMode = 'timeline' | 'search';

function StatsHeader({ scope }: { scope: string }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['memory-stats', scope],
    queryFn: () => fetchStats(scope),
  });

  const cards = [
    {
      label: 'Total Facts',
      value: stats?.facts ?? 0,
      icon: BrainIcon,
    },
    {
      label: 'Episodes',
      value: stats?.episodes ?? 0,
      icon: BookOpenIcon,
    },
    {
      label: 'Cells',
      value: stats?.cells ?? 0,
      icon: LayersIcon,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <card.icon className="size-4 text-primary" />
            </div>
            <div>
              {isLoading ? (
                <Skeleton className="h-5 w-10 mb-1" />
              ) : (
                <p className="text-lg font-semibold leading-tight">
                  {card.value.toLocaleString()}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MemoryPage() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  const [scope, setScope] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  // Initialize scope once we have the user ID
  const activeScope = scope ?? (userId ? `user:${userId}` : null);

  const handleScopeChange = (newScope: string) => {
    setScope(newScope);
  };

  if (!userId || !activeScope) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Memory</h2>
          <p className="text-sm text-muted-foreground">
            Knowledge organized into episodes and facts from conversations
          </p>
        </div>
        <MemoryScopeSelector
          scope={activeScope}
          onScopeChange={handleScopeChange}
          userId={userId}
        />
      </div>

      {/* Stats */}
      <StatsHeader scope={activeScope} />

      {/* View Toggle */}
      <div className="flex items-center gap-1 border-b">
        <Button
          variant="ghost"
          size="sm"
          className={`gap-1.5 rounded-none border-b-2 ${
            viewMode === 'timeline'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setViewMode('timeline')}
        >
          <ClockIcon className="size-3.5" />
          Timeline
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`gap-1.5 rounded-none border-b-2 ${
            viewMode === 'search'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setViewMode('search')}
        >
          <SearchIcon className="size-3.5" />
          Search
        </Button>
      </div>

      {/* Content */}
      {viewMode === 'timeline' ? (
        <MemoryTimeline scope={activeScope} />
      ) : (
        <MemorySearchView scope={activeScope} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/ai/memory')({
  component: MemoryPage,
});
