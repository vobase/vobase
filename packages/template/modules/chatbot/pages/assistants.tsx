import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Assistant {
  id: string;
  name: string;
  model: string | null;
  systemPrompt: string | null;
  createdAt: string;
}

async function fetchAssistants(): Promise<Assistant[]> {
  const res = await fetch('/api/chatbot/assistants');
  if (!res.ok) throw new Error('Failed to fetch assistants');
  return res.json();
}

function AssistantsPage() {
  const queryClient = useQueryClient();
  const { data: assistants, isLoading } = useQuery({
    queryKey: ['chatbot-assistants'],
    queryFn: fetchAssistants,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/chatbot/assistants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Assistant' }),
      });
      if (!res.ok) throw new Error('Failed to create assistant');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chatbot-assistants'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/chatbot/assistants/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete assistant');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chatbot-assistants'] }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Assistants</h2>
          <p className="text-sm text-muted-foreground">Manage chatbot assistants</p>
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Creating...' : 'New assistant'}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {assistants && assistants.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No assistants yet. Create one to get started.
        </p>
      )}

      {assistants && assistants.length > 0 && (
        <div className="space-y-2">
          {assistants.map((assistant) => (
            <Card key={assistant.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{assistant.name}</p>
                  <p className="text-xs text-muted-foreground">{assistant.model ?? 'Default model'}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(assistant.id)}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/chatbot/assistants')({
  component: AssistantsPage,
});
