import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient } from '@/lib/api-client';

interface Episode {
  id: string;
  cellId: string;
  title: string;
  content: string;
  threadId: string | null;
  factCount: number;
  createdAt: string;
}

interface Fact {
  id: string;
  cellId: string;
  fact: string;
  subject: string | null;
  occurredAt: string | null;
  createdAt: string;
}

interface EpisodesResponse {
  episodes: Episode[];
  nextCursor: string | null;
}

interface FactsResponse {
  facts: Fact[];
  nextCursor: string | null;
}

async function fetchEpisodes(
  scope: string,
  cursor?: string,
): Promise<EpisodesResponse> {
  const res = await aiClient.memory.episodes.$get({
    query: { scope, ...(cursor ? { cursor } : {}) },
  });
  if (!res.ok) throw new Error('Failed to fetch episodes');
  return res.json();
}

async function fetchFacts(
  scope: string,
  episodeId: string,
): Promise<FactsResponse> {
  const res = await aiClient.memory.facts.$get({ query: { scope, episodeId } });
  if (!res.ok) throw new Error('Failed to fetch facts');
  return res.json();
}

async function deleteFact(factId: string): Promise<void> {
  const res = await aiClient.memory.facts[':id'].$delete({
    param: { id: factId },
  });
  if (!res.ok) throw new Error('Failed to delete fact');
}

function EpisodeItem({ episode, scope }: { episode: Episode; scope: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: factsData, isLoading: factsLoading } = useQuery({
    queryKey: ['memory-facts', episode.id, scope],
    queryFn: () => fetchFacts(scope, episode.id),
    enabled: expanded,
  });

  const deleteFactMutation = useMutation({
    mutationFn: deleteFact,
    onMutate: async (factId) => {
      await queryClient.cancelQueries({
        queryKey: ['memory-facts', episode.id, scope],
      });
      const previous = queryClient.getQueryData<FactsResponse>([
        'memory-facts',
        episode.id,
        scope,
      ]);
      queryClient.setQueryData<FactsResponse>(
        ['memory-facts', episode.id, scope],
        (old) =>
          old
            ? { ...old, facts: old.facts.filter((f) => f.id !== factId) }
            : old,
      );
      return { previous };
    },
    onError: (_err, _factId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['memory-facts', episode.id, scope],
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['memory-facts', episode.id, scope],
      });
      queryClient.invalidateQueries({
        queryKey: ['memory-episodes', scope],
      });
      queryClient.invalidateQueries({
        queryKey: ['memory-stats', scope],
      });
    },
  });

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{episode.title}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(episode.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        {episode.factCount > 0 && (
          <Badge variant="secondary" className="text-xs shrink-0">
            {episode.factCount} {episode.factCount === 1 ? 'fact' : 'facts'}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Summary
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {episode.content}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Facts
            </p>
            {factsLoading && (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            )}
            {factsData && factsData.facts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No facts extracted from this episode.
              </p>
            )}
            {factsData && factsData.facts.length > 0 && (
              <div className="space-y-1.5">
                {factsData.facts.map((fact) => (
                  <div
                    key={fact.id}
                    className="flex items-start gap-2 group rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50"
                  >
                    <span className="text-sm flex-1">{fact.fact}</span>
                    {fact.subject && (
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0 mt-0.5"
                      >
                        {fact.subject}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFactMutation.mutate(fact.id);
                      }}
                      disabled={deleteFactMutation.isPending}
                    >
                      <Trash2Icon className="size-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MemoryTimeline({ scope }: { scope: string }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['memory-episodes', scope, cursor],
    queryFn: () => fetchEpisodes(scope, cursor),
    placeholderData: (prev) => prev,
  });

  // Reset pagination when scope changes
  const prevScope = useRef(scope);
  useEffect(() => {
    if (prevScope.current !== scope) {
      prevScope.current = scope;
      setCursor(undefined);
      setAllEpisodes([]);
    }
  }, [scope]);

  // Merge new episodes when data changes
  const episodes =
    cursor === undefined
      ? (data?.episodes ?? [])
      : [...allEpisodes, ...(data?.episodes ?? [])];

  const handleLoadMore = () => {
    if (data?.nextCursor) {
      setAllEpisodes(episodes);
      setCursor(data.nextCursor);
    }
  };

  if (isLoading && episodes.length === 0) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BookOpenIcon className="size-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No memories yet. Conversations will be processed into episodes and
          facts automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {episodes.map((episode) => (
        <EpisodeItem key={episode.id} episode={episode} scope={scope} />
      ))}
      {data?.nextCursor && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={isFetching}
          >
            {isFetching && <Loader2Icon className="size-3.5 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
