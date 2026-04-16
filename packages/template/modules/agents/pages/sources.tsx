import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import { knowledgeBaseClient } from '@/lib/api-client';

interface KBSource {
  id: string;
  name: string;
  type: string;
  status: string;
  lastSyncAt: string | null;
  syncSchedule: string | null;
}

async function fetchSources() {
  const res = await knowledgeBaseClient.sources.$get();
  if (!res.ok) throw new Error('Failed to fetch sources');
  return res.json();
}

type StatusVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

function sourceStatusVariant(status: string): StatusVariant {
  if (status === 'active' || status === 'connected') return 'success';
  if (status === 'syncing') return 'warning';
  if (status === 'error' || status === 'failed') return 'error';
  return 'default';
}

function SourcesPage() {
  const queryClient = useQueryClient();
  const { data: sources, isLoading } = useQuery({
    queryKey: ['kb-sources'],
    queryFn: fetchSources,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('crawl');
  const [newUrl, setNewUrl] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      const config = newType === 'crawl' ? { url: newUrl } : {};
      const res = await knowledgeBaseClient.sources.$post({
        json: { name: newName, type: newType, config },
      });
      if (!res.ok) throw new Error('Create failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-sources'] });
      setShowAdd(false);
      setNewName('');
      setNewUrl('');
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await knowledgeBaseClient.sources[':id'].sync.$post({
        param: { id },
      });
      if (!res.ok) throw new Error('Sync failed');
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['kb-sources'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await knowledgeBaseClient.sources[':id'].$delete({
        param: { id },
      });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['kb-sources'] }),
  });

  async function handleConnect(source: KBSource) {
    if (source.type === 'google-drive' || source.type === 'sharepoint') {
      // biome-ignore lint/style/noRestrictedGlobals: No typed auth-url route
      const res = await fetch(
        `/api/knowledge-base/sources/${source.id}/auth-url`,
      );
      const { url } = await res.json();
      window.location.href = url;
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add source'}
        </Button>
      </div>

      {showAdd && (
        <Card className="mb-6">
          <CardContent className="space-y-3">
            <Input
              placeholder="Source name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex gap-2">
              {(['crawl', 'google-drive', 'sharepoint'] as const).map(
                (type) => (
                  <Button
                    key={type}
                    variant={newType === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setNewType(type)}
                  >
                    {type === 'crawl'
                      ? 'Web Crawl'
                      : type === 'google-drive'
                        ? 'Google Drive'
                        : 'SharePoint'}
                  </Button>
                ),
              )}
            </div>
            {newType === 'crawl' && (
              <Input
                placeholder="URL to crawl"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            )}
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              Create source
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      )}

      {!isLoading && sources && sources.length === 0 && !showAdd && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium">No sources configured</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a source to start syncing documents automatically.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setShowAdd(true)}>
            Add source
          </Button>
        </div>
      )}

      {sources && sources.length > 0 && (
        <div className="space-y-3">
          {sources.map((source) => (
            <Card
              key={source.id}
              className="transition-colors hover:bg-muted/30"
            >
              <CardContent className="flex items-center justify-between py-4 px-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Status variant={sourceStatusVariant(source.status)}>
                      <StatusIndicator />
                      <StatusLabel className="capitalize">
                        {source.status}
                      </StatusLabel>
                    </Status>
                    <p className="text-sm font-medium">{source.name}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 ml-4">
                    <Badge variant="outline" className="text-xs font-normal">
                      {source.type}
                    </Badge>
                    {source.lastSyncAt && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        &middot; synced{' '}
                        <RelativeTimeCard date={source.lastSyncAt} />
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 ml-4">
                  {(source.type === 'google-drive' ||
                    source.type === 'sharepoint') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConnect(source)}
                    >
                      Connect
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncMutation.mutate(source.id)}
                    disabled={syncMutation.isPending}
                  >
                    Sync
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(source.id)}
                    disabled={deleteMutation.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/agents/sources')({
  component: SourcesPage,
});
