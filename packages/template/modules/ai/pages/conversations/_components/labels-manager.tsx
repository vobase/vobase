import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, XIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { aiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────

interface Label {
  id: string;
  title: string;
  color: string | null;
  description: string | null;
  createdAt: string;
}

// ─── Component ───────────────────────────────────────────────────────

export function LabelsManager({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const [popoverOpen, setPopoverOpen] = useState(false);

  // All labels
  const { data: allLabels = [] } = useQuery({
    queryKey: ['labels'],
    queryFn: async () => {
      const res = await aiClient.labels.$get();
      if (!res.ok) return [];
      return res.json() as Promise<Label[]>;
    },
  });

  // Labels on this conversation
  const { data: conversationLabels = [] } = useQuery({
    queryKey: ['conversation-labels', conversationId],
    queryFn: async () => {
      const res = await aiClient.conversations[':id'].labels.$get({
        param: { id: conversationId },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Label[]>;
    },
  });

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['conversation-labels', conversationId],
    });
    // Refresh conversation lists so label chips update
    queryClient.invalidateQueries({ queryKey: ['conversations-attention'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-ai-active'] });
    queryClient.invalidateQueries({ queryKey: ['conversations-resolved'] });
    // Refresh timeline to show label activity event
    queryClient.invalidateQueries({
      queryKey: ['conversations-messages', conversationId],
    });
  }, [queryClient, conversationId]);

  const addMutation = useMutation({
    mutationFn: async (labelId: string) => {
      await aiClient.conversations[':id'].labels.$post(
        { param: { id: conversationId } },
        {
          init: {
            body: JSON.stringify({ labelIds: [labelId] }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
    },
    onSuccess: invalidateAll,
  });

  const removeMutation = useMutation({
    mutationFn: async (labelId: string) => {
      await aiClient.conversations[':id'].labels[':lid'].$delete({
        param: { id: conversationId, lid: labelId },
      });
    },
    onSuccess: invalidateAll,
  });

  const assignedIds = new Set(conversationLabels.map((l) => l.id));
  const available = allLabels.filter((l) => !assignedIds.has(l.id));

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Labels
      </p>

      {/* Assigned labels */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {conversationLabels.map((label) => (
          <Badge
            key={label.id}
            variant="secondary"
            className="gap-1 pr-1 text-xs"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: label.color ?? '#6b7280' }}
            />
            {label.title}
            <button
              type="button"
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              onClick={() => removeMutation.mutate(label.id)}
              disabled={removeMutation.isPending}
            >
              <XIcon className="size-2.5" />
            </button>
          </Badge>
        ))}

        {/* Add label button */}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground"
            >
              <PlusIcon className="size-3 mr-0.5" />
              Add
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            {available.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                No more labels available
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {available.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted transition-colors"
                    onClick={() => {
                      addMutation.mutate(label.id);
                      setPopoverOpen(false);
                    }}
                    disabled={addMutation.isPending}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: label.color ?? '#6b7280' }}
                    />
                    <span className="truncate">{label.title}</span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
