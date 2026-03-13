import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface KBSource {
  id: string;
  name: string;
  type: string;
  status: string;
  lastSyncAt: string | null;
  syncSchedule: string | null;
}

async function fetchSources() {
  const res = await fetch('/api/knowledge-base/sources');
  if (!res.ok) throw new Error('Failed to fetch sources');
  return res.json() as Promise<KBSource[]>;
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
      const res = await fetch('/api/knowledge-base/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, type: newType, config }),
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
      const res = await fetch(`/api/knowledge-base/sources/${id}/sync`, { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kb-sources'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/knowledge-base/sources/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kb-sources'] }),
  });

  async function handleConnect(source: KBSource) {
    if (source.type === 'google-drive' || source.type === 'sharepoint') {
      const res = await fetch(`/api/knowledge-base/sources/${source.id}/auth-url`);
      const { url } = await res.json();
      window.location.href = url;
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Sources</h2>
          <p className="text-sm text-muted-foreground">Connect external document sources</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add source'}</Button>
      </div>

      {showAdd && (
        <Card className="mb-6">
          <CardContent className="pt-4 space-y-3">
            <Input
              placeholder="Source name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex gap-2">
              {(['crawl', 'google-drive', 'sharepoint'] as const).map((type) => (
                <Button
                  key={type}
                  variant={newType === type ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setNewType(type)}
                >
                  {type === 'crawl' ? 'Web Crawl' : type === 'google-drive' ? 'Google Drive' : 'SharePoint'}
                </Button>
              ))}
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
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {sources && sources.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No sources configured. Add a source to start syncing documents.
        </p>
      )}

      {sources && sources.length > 0 && (
        <div className="space-y-3">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">{source.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {source.type}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {source.status}
                    </Badge>
                    {source.lastSyncAt && (
                      <span className="text-xs text-muted-foreground">
                        Last sync: {new Date(source.lastSyncAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(source.type === 'google-drive' || source.type === 'sharepoint') && (
                    <Button variant="outline" size="sm" onClick={() => handleConnect(source)}>
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

export const Route = createFileRoute('/_app/knowledge-base/sources')({
  component: SourcesPage,
});
