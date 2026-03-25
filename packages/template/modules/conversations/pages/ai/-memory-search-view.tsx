import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface SearchEpisode {
  id: string;
  cellId: string;
  title: string;
  content: string;
  score: number;
}

interface SearchFact {
  id: string;
  cellId: string;
  fact: string;
  subject: string | null;
  score: number;
}

interface SearchResult {
  episodes: SearchEpisode[];
  facts: SearchFact[];
  originalMessages: Array<{
    content: string;
    role: string;
    createdAt: string;
  }>;
}

async function searchMemory(
  scope: string,
  query: string,
): Promise<SearchResult> {
  const params = new URLSearchParams({ scope, q: query });
  const res = await globalThis.fetch(`/api/ai/memory/search?${params}`);
  if (!res.ok) throw new Error('Failed to search memory');
  return res.json();
}

async function deleteFact(factId: string): Promise<void> {
  const res = await globalThis.fetch(`/api/ai/memory/facts/${factId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete fact');
}

function ExpandableEpisode({ episode }: { episode: SearchEpisode }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-medium flex-1 truncate">
          {episode.title}
        </span>
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {Math.round(episode.score * 100)}% match
        </Badge>
      </button>
      {expanded && (
        <div className="border-t px-3 py-2">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {episode.content}
          </p>
        </div>
      )}
    </div>
  );
}

function FactResult({
  fact,
  onDelete,
  isDeleting,
}: {
  fact: SearchFact;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="flex items-start gap-2 group rounded-md px-3 py-2 hover:bg-muted/50">
      <span className="text-sm flex-1">{fact.fact}</span>
      {fact.subject && (
        <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
          {fact.subject}
        </Badge>
      )}
      <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">
        {Math.round(fact.score * 100)}%
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onDelete}
        disabled={isDeleting}
      >
        <Trash2Icon className="size-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

export function MemorySearchView({ scope }: { scope: string }) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['memory-search', scope, debouncedQuery],
    queryFn: () => searchMemory(scope, debouncedQuery),
    enabled: debouncedQuery.length > 0,
  });

  const deleteFactMutation = useMutation({
    mutationFn: deleteFact,
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['memory-search', scope],
      });
      queryClient.invalidateQueries({
        queryKey: ['memory-stats', scope],
      });
      queryClient.invalidateQueries({
        queryKey: ['memory-episodes', scope],
      });
    },
  });

  const hasQuery = debouncedQuery.length > 0;
  const hasResults =
    data && (data.episodes.length > 0 || data.facts.length > 0);

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search across all memories in this scope..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="pl-9"
        />
      </div>

      {!hasQuery && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SearchIcon className="size-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            Search across all memories in this scope
          </p>
        </div>
      )}

      {hasQuery && (isLoading || isFetching) && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-3/4 rounded-md" />
        </div>
      )}

      {hasQuery && !isLoading && !isFetching && !hasResults && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No results found for &ldquo;{debouncedQuery}&rdquo;
        </p>
      )}

      {hasResults && !isFetching && (
        <div className="space-y-6">
          {data.episodes.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Episodes ({data.episodes.length})
              </h4>
              <div className="space-y-1.5">
                {data.episodes.map((episode) => (
                  <ExpandableEpisode key={episode.id} episode={episode} />
                ))}
              </div>
            </div>
          )}

          {data.facts.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Facts ({data.facts.length})
              </h4>
              <div className="rounded-md border bg-card divide-y">
                {data.facts.map((fact) => (
                  <FactResult
                    key={fact.id}
                    fact={fact}
                    onDelete={() => deleteFactMutation.mutate(fact.id)}
                    isDeleting={deleteFactMutation.isPending}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
