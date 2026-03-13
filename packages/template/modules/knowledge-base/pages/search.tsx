import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchBar } from '@/components/search-bar';
import { EXAMPLES, AUTOCOMPLETE_SEED, CATEGORIES } from '@/config/search';

async function searchKnowledgeBase(query: string) {
  const res = await fetch('/api/knowledge-base/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 20 }),
  });
  if (!res.ok) throw new Error('Search failed');
  return res.json() as Promise<{
    query: string;
    results: Array<{
      chunkId: string;
      documentId: string;
      documentTitle: string;
      content: string;
      score: number;
      chunkIndex: number;
    }>;
  }>;
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
      <h2 className="text-lg font-semibold mb-1">Knowledge Base</h2>
      <p className="text-sm text-muted-foreground mb-6">Search across all documents and sources</p>

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
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {data?.results && data.results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No results found for &ldquo;{searchQuery}&rdquo;
        </p>
      )}

      {data?.results && data.results.length > 0 && (
        <div className="space-y-3">
          {data.results.map((result) => (
            <Card key={result.chunkId}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium">{result.documentTitle}</span>
                  <Badge variant="secondary" className="text-xs">
                    {Math.round(result.score * 100)}% match
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">{result.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!searchQuery && (
        <p className="text-sm text-muted-foreground text-center py-12">
          Enter a search query to find relevant documents
        </p>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/knowledge-base/search')({
  component: KnowledgeBaseSearch,
});
