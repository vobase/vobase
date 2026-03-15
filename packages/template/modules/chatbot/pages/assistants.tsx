import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Assistant {
  id: string;
  name: string;
  model: string | null;
  systemPrompt: string | null;
  suggestions: string | null;
  createdAt: string;
}

interface EditForm {
  name: string;
  model: string;
  systemPrompt: string;
  suggestions: string;
}

async function fetchAssistants(): Promise<Assistant[]> {
  const res = await fetch('/api/chatbot/assistants');
  if (!res.ok) throw new Error('Failed to fetch assistants');
  return res.json();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function AssistantsPage() {
  const queryClient = useQueryClient();
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', model: '', systemPrompt: '', suggestions: '' });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<EditForm> }) => {
      const res = await fetch(`/api/chatbot/assistants/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update assistant');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-assistants'] });
      setEditingAssistant(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/chatbot/assistants/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete assistant');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-assistants'] });
      setDeleteConfirmId(null);
    },
  });

  function openEdit(assistant: Assistant) {
    setEditingAssistant(assistant);
    const parsedSuggestions = (() => {
      try { return JSON.parse(assistant.suggestions ?? '[]') as string[]; }
      catch { return []; }
    })();
    setEditForm({
      name: assistant.name,
      model: assistant.model ?? '',
      systemPrompt: assistant.systemPrompt ?? '',
      suggestions: parsedSuggestions.join('\n'),
    });
  }

  function handleSaveEdit() {
    if (!editingAssistant) return;
    const suggestionLines = editForm.suggestions.split('\n').map(s => s.trim()).filter(Boolean);
    updateMutation.mutate({
      id: editingAssistant.id,
      data: {
        name: editForm.name,
        model: editForm.model || undefined,
        systemPrompt: editForm.systemPrompt || undefined,
        suggestions: suggestionLines.length > 0 ? JSON.stringify(suggestionLines) : undefined,
      },
    });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Assistants</h2>
          <p className="text-sm text-muted-foreground">Manage chatbot assistants</p>
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Creating…' : 'Create assistant'}
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {assistants && assistants.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No assistants yet. Create one to get started.
        </p>
      )}

      {assistants && assistants.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assistants.map((assistant) => (
            <Card key={assistant.id} className="flex flex-col">
              <CardContent className="flex-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-semibold text-sm leading-tight">{assistant.name}</p>
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {assistant.model ?? 'Default'}
                  </Badge>
                </div>
                {assistant.systemPrompt ? (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {assistant.systemPrompt}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground/50 italic mb-2">No system prompt</p>
                )}
                <p className="text-xs text-muted-foreground mb-3">
                  Created {formatDate(assistant.createdAt)}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEdit(assistant)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirmId(assistant.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editingAssistant} onOpenChange={(open) => { if (!open) setEditingAssistant(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit assistant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="assistant-name">Name</Label>
              <Input
                id="assistant-name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Assistant name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-model">Model</Label>
              <Input
                id="assistant-model"
                value={editForm.model}
                onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="e.g. gpt-5-mini, claude-haiku-4-5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-prompt">System prompt</Label>
              <Textarea
                id="assistant-prompt"
                value={editForm.systemPrompt}
                onChange={(e) => setEditForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="You are a helpful assistant…"
                className="min-h-[120px] resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-suggestions">Quick suggestions</Label>
              <Textarea
                id="assistant-suggestions"
                value={editForm.suggestions}
                onChange={(e) => setEditForm((f) => ({ ...f, suggestions: e.target.value }))}
                placeholder={"Help me write a function that\nExplain how\nSearch the knowledge base for"}
                className="min-h-[80px] resize-none"
              />
              <p className="text-xs text-muted-foreground">One suggestion per line. Shown as quick-start prompts in new chats.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAssistant(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending || !editForm.name.trim()}>
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete assistant</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this assistant? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Route = createFileRoute('/_app/chatbot/assistants')({
  component: AssistantsPage,
});
