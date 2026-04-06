import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PencilIcon, PlusIcon, TagIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────

interface Label {
  id: string;
  title: string;
  color: string | null;
  description: string | null;
  createdAt: string;
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchLabels(): Promise<Label[]> {
  const res = await aiClient.labels.$get();
  if (!res.ok) throw new Error('Failed to fetch labels');
  return res.json() as Promise<Label[]>;
}

// ─── Color presets ───────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
];

// ─── Label Form Dialog ──────────────────────────────────────────────

function LabelFormDialog({
  open,
  onOpenChange,
  label,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label?: Label | null;
  onSave: (data: { title: string; color: string; description: string }) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(label?.title ?? '');
  const [color, setColor] = useState(label?.color ?? COLOR_PRESETS[5]);
  const [description, setDescription] = useState(label?.description ?? '');

  // Reset form when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setTitle(label?.title ?? '');
      setColor(label?.color ?? COLOR_PRESETS[5]);
      setDescription(label?.description ?? '');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{label ? 'Edit label' : 'Create label'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="label-title">
              Title
            </label>
            <Input
              id="label-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Bug, VIP, Urgent"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="label-desc">
              Description
            </label>
            <Input
              id="label-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Color</span>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-7 w-7 rounded-full border-2 transition-all ${
                    color === c
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:border-muted-foreground/50'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave({ title, color, description })}
            disabled={!title.trim() || isPending}
          >
            {label ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

function LabelsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);

  const { data: labelsList = [], isLoading } = useQuery({
    queryKey: ['labels'],
    queryFn: fetchLabels,
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      color: string;
      description: string;
    }) => {
      const res = await aiClient.labels.$post(
        {},
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to create label');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels'] });
      setDialogOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { title: string; color: string; description: string };
    }) => {
      const res = await aiClient.labels[':id'].$patch(
        { param: { id } },
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to update label');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels'] });
      setDialogOpen(false);
      setEditingLabel(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await aiClient.labels[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error('Failed to delete label');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
  });

  function handleSave(data: {
    title: string;
    color: string;
    description: string;
  }) {
    if (editingLabel) {
      updateMutation.mutate({ id: editingLabel.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function openEdit(label: Label) {
    setEditingLabel(label);
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingLabel(null);
    setDialogOpen(true);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Labels</h1>
          <p className="text-sm text-muted-foreground">
            Manage conversation labels for organization and filtering.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <PlusIcon className="size-3.5" />
          New label
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`skel-${i.toString()}`} className="h-14 w-full" />
          ))}
        </div>
      ) : labelsList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <TagIcon className="size-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No labels yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create labels to organize your conversations.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-1.5"
            onClick={openCreate}
          >
            <PlusIcon className="size-3.5" />
            Create first label
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {labelsList.map((label) => (
            <div
              key={label.id}
              className="flex items-center gap-3 px-4 py-3 group"
            >
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: label.color ?? '#6b7280' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{label.title}</p>
                {label.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {label.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => openEdit(label)}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(label.id)}
                  disabled={deleteMutation.isPending}
                >
                  <TrashIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <LabelFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        label={editingLabel}
        onSave={handleSave}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/labels' as never)({
  component: LabelsPage,
});
