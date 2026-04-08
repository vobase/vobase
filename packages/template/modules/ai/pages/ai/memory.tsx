import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BrainIcon } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';

async function fetchWorkingMemory(scope: string): Promise<string | null> {
  const res = await aiClient.memory.working.$get({ query: { scope } });
  if (!res.ok) return null;
  const data = (await res.json()) as unknown as {
    workingMemory: string | null;
  };
  return data.workingMemory ?? null;
}

function MemoryPage() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const [scopeInput, setScopeInput] = useState('');

  const activeScope = scopeInput.trim() || (userId ? `user:${userId}` : null);

  const { data: workingMemory, isLoading } = useQuery({
    queryKey: ['memory-working', activeScope],
    queryFn: () => fetchWorkingMemory(activeScope!),
    enabled: !!activeScope,
  });

  if (!userId) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Working Memory</h2>
        <Input
          placeholder="Scope (e.g. contact:abc123)"
          value={scopeInput}
          onChange={(e) => setScopeInput(e.target.value)}
          className="w-72"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {!isLoading && workingMemory && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <BrainIcon className="h-4 w-4 text-primary/60" />
              <span className="text-sm font-medium">Agent's live context</span>
              <span className="text-xs text-muted-foreground">
                ({activeScope})
              </span>
            </div>
            <div className="text-sm text-foreground leading-relaxed bg-muted/50 rounded-md p-3 overflow-auto max-h-96 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:my-0 [&_strong]:font-medium [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded">
              <Markdown remarkPlugins={[remarkGfm]}>{workingMemory}</Markdown>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !workingMemory && (
        <div className="rounded-lg border bg-muted/20 py-12 text-center">
          <BrainIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No working memory for this scope yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Working memory is built from agent conversations.
          </p>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/_ai/ai/memory')({
  component: MemoryPage,
});
