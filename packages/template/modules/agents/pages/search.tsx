import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { SearchBar } from '@/components/search-bar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AUTOCOMPLETE_SEED, CATEGORIES, EXAMPLES } from '@/config/search';
import { knowledgeBaseClient } from '@/lib/api-client';

async function searchKnowledgeBase(query: string) {
  const res = await knowledgeBaseClient.search.$post({
    json: { query, limit: 20 },
  });
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

function highlightTerms(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (terms.length === 0) return text;
  const regex = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(regex);
  const result: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (regex.test(part)) {
      result.push(
        <mark
          key={part}
          className="bg-transparent font-semibold text-foreground not-italic"
        >
          {part}
        </mark>,
      );
    } else {
      result.push(part);
    }
  }
  return result;
}

function KnowledgeBaseSearch() {
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['kb-search', searchQuery],
    queryFn: () => searchKnowledgeBase(searchQuery),
    enabled: searchQuery.length > 0,
  });

  function handleSearch(query: string) {
    setSearchQuery(query);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <SearchBar
          onSearch={handleSearch}
          examples={EXAMPLES}
          autocompleteConfig={{
            seed: AUTOCOMPLETE_SEED,
            categories: CATEGORIES,
            suggestionsUrl: '/api/knowledge-base/suggestions',
            cacheKey: 'kb_autocomplete_v1',
          }}
          autoFocus
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Card>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </CardContent>
          </Card>
        </div>
      )}

      {data?.results && data.results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No results found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No matches for &ldquo;{searchQuery}&rdquo;. Try different keywords.
          </p>
        </div>
      )}

      {data?.results && data.results.length > 0 && (
        <div className="space-y-3">
          {data.results.map((result) => {
            const scorePct = Math.round(result.score * 100);
            return (
              <Card
                key={result.chunkId}
                className="transition-colors hover:bg-muted/30"
              >
                <CardContent>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-xs font-normal"
                      >
                        {result.documentTitle}
                      </Badge>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Progress
                        value={scorePct}
                        className="h-1.5 w-16"
                        aria-label={`${scorePct}% relevance`}
                      />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {scorePct}%
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                    {highlightTerms(result.content, searchQuery)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!searchQuery && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Enter a query above to search your knowledge base
          </p>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/agents/search')({
  component: KnowledgeBaseSearch,
});
