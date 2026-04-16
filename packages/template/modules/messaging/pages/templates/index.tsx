import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  EditIcon,
  InfoIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  TrashIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import { Textarea } from '@/components/ui/textarea';
import { useDataTable } from '@/hooks/use-data-table';
import { messagingClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────

interface Template {
  id: string;
  channel: string;
  externalId: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: string | null;
  syncedAt: string;
  createdAt: string;
}

type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchTemplates(): Promise<Template[]> {
  const res = await messagingClient.templates.$get();
  if (!res.ok) throw new Error('Failed to fetch templates');
  const json = await res.json();
  return json.templates as Template[];
}

// ─── Status variant ──────────────────────────────────────────────────

type StatusVariant = 'success' | 'warning' | 'error' | 'default' | 'info';

function templateStatusVariant(status: string | null): StatusVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'DRAFT') return 'default';
  if (status === 'PENDING' || status === 'PENDING_DELETION') return 'warning';
  if (status === 'REJECTED' || status === 'DISABLED' || status === 'PAUSED')
    return 'error';
  return 'default';
}

function templateStatusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    PENDING: 'Pending Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    DISABLED: 'Disabled',
    PAUSED: 'Paused',
    PENDING_DELETION: 'Pending Deletion',
  };
  return labels[status] ?? status;
}

// ─── Template body helpers ──────────────────────────────────────────

function getTemplateBodyText(components: string | null): string {
  if (!components) return '';
  try {
    const parsed = JSON.parse(components) as Array<{
      type: string;
      text?: string;
    }>;
    const body = parsed.find((c) => c.type === 'BODY');
    return body?.text ?? '';
  } catch {
    return '';
  }
}

function getNextVariableNumber(text: string): number {
  const matches = text.match(/\{\{(\d+)\}\}/g);
  if (!matches) return 1;
  const nums = matches.map((m) => Number.parseInt(m.replace(/[{}]/g, ''), 10));
  return Math.max(...nums) + 1;
}

// ─── Columns ─────────────────────────────────────────────────────────

function createColumns(
  onEdit: (t: Template) => void,
  onSubmit: (t: Template) => void,
  onDelete: (t: Template) => void,
): ColumnDef<Template>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Name" />
      ),
      cell: ({ row }) => (
        <span className="font-medium font-mono text-sm">
          {row.original.name}
        </span>
      ),
      meta: {
        label: 'Search',
        variant: 'text',
        placeholder: 'Search templates...',
      },
      enableColumnFilter: true,
      enableSorting: true,
      enableHiding: false,
    },
    {
      id: 'category',
      accessorKey: 'category',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Category" />
      ),
      cell: ({ row }) => {
        const val = row.getValue('category') as string | null;
        if (!val)
          return <span className="text-muted-foreground/40">&mdash;</span>;
        return (
          <Badge variant="outline" className="capitalize text-xs font-normal">
            {val.toLowerCase().replace(/_/g, ' ')}
          </Badge>
        );
      },
      filterFn: (row, id, value) =>
        Array.isArray(value)
          ? value.includes(row.getValue(id))
          : row.getValue(id) === value,
      meta: {
        label: 'Category',
        variant: 'multiSelect',
        options: [
          { label: 'Marketing', value: 'MARKETING' },
          { label: 'Utility', value: 'UTILITY' },
          { label: 'Authentication', value: 'AUTHENTICATION' },
        ],
      },
      enableColumnFilter: true,
      enableSorting: true,
    },
    {
      id: 'body',
      header: 'Body',
      cell: ({ row }) => {
        const body = getTemplateBodyText(row.original.components);
        if (!body)
          return <span className="text-muted-foreground/40">&mdash;</span>;
        return (
          <span className="text-sm text-muted-foreground line-clamp-1 max-w-[300px]">
            {body}
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Status" />
      ),
      cell: ({ row }) => {
        const s = row.getValue('status') as string | null;
        return (
          <Status variant={templateStatusVariant(s)}>
            <StatusIndicator />
            <StatusLabel>{templateStatusLabel(s)}</StatusLabel>
          </Status>
        );
      },
      filterFn: (row, id, value) =>
        Array.isArray(value)
          ? value.includes(row.getValue(id))
          : row.getValue(id) === value,
      meta: {
        label: 'Status',
        variant: 'multiSelect',
        options: [
          { label: 'Draft', value: 'DRAFT' },
          { label: 'Pending Review', value: 'PENDING' },
          { label: 'Approved', value: 'APPROVED' },
          { label: 'Rejected', value: 'REJECTED' },
          { label: 'Disabled', value: 'DISABLED' },
        ],
      },
      enableColumnFilter: true,
      enableSorting: true,
    },
    {
      id: 'syncedAt',
      accessorKey: 'syncedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Updated" />
      ),
      cell: ({ row }) => (
        <RelativeTimeCard date={row.getValue('syncedAt') as string} />
      ),
      meta: { label: 'Updated' },
      enableSorting: true,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const template = row.original;
        const isDraft = template.status === 'DRAFT';
        const isRejected = template.status === 'REJECTED';
        const canSubmit = isDraft || isRejected;

        return (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <EditIcon className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
              {isDraft && (
                <DropdownMenuItem onClick={() => onEdit(template)}>
                  <EditIcon className="size-3.5 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              {canSubmit && (
                <DropdownMenuItem onClick={() => onSubmit(template)}>
                  <SendIcon className="size-3.5 mr-2" />
                  Submit for Review
                </DropdownMenuItem>
              )}
              {(isDraft || canSubmit) && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(template)}
              >
                <TrashIcon className="size-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

// ─── Create/Edit Template Dialog ────────────────────────────────────

const BODY_MAX_CHARS = 1024;

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .replace(/\s+/g, '_');
}

function TemplateDialog({
  open,
  onOpenChange,
  editTemplate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTemplate: Template | null;
}) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('UTILITY');
  const [bodyText, setBodyText] = useState('');

  // Sync state when editTemplate changes
  const prevEditId = useRef<string | null>(null);
  if (editTemplate && editTemplate.id !== prevEditId.current) {
    prevEditId.current = editTemplate.id;
    setName(editTemplate.name);
    setCategory((editTemplate.category as TemplateCategory) ?? 'UTILITY');
    setBodyText(getTemplateBodyText(editTemplate.components));
  } else if (!editTemplate && prevEditId.current !== null) {
    prevEditId.current = null;
  }

  const isEditing = !!editTemplate;

  const createMutation = useMutation({
    mutationFn: async () => {
      const components: Array<{ type: string; [key: string]: unknown }> = [
        { type: 'BODY', text: bodyText },
      ];
      const res = await messagingClient.templates.$post({
        json: { name, language: 'en', category, components },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as Record<string, string> | null)?.message ??
            'Failed to create template',
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-templates'] });
      onOpenChange(false);
      resetForm();
      toast.success('Template created as draft');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editTemplate) return;
      const components: Array<{ type: string; [key: string]: unknown }> = [
        { type: 'BODY', text: bodyText },
      ];
      const res = await messagingClient.templates[':id'].$put(
        { param: { id: editTemplate.id } },
        {
          init: {
            body: JSON.stringify({ category, components }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as Record<string, string> | null)?.message ??
            'Failed to update template',
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-templates'] });
      onOpenChange(false);
      resetForm();
      toast.success('Template updated');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  function resetForm() {
    setName('');
    setCategory('UTILITY');
    setBodyText('');
    prevEditId.current = null;
  }

  function insertVariable() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const nextNum = getNextVariableNumber(bodyText);
    const variable = `{{${nextNum}}}`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText =
      bodyText.substring(0, start) + variable + bodyText.substring(end);
    setBodyText(newText);

    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + variable.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Template' : 'New Template'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              placeholder="order_confirmation"
              value={name}
              onChange={(e) => setName(slugifyName(e.target.value))}
              disabled={isEditing}
            />
            {!isEditing && (
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and underscores only.
              </p>
            )}
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as TemplateCategory)}
            >
              <SelectTrigger id="template-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTILITY">Utility</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Marketing info banner */}
          {category === 'MARKETING' && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                Unsubscribe button will be added automatically when submitted.
              </span>
            </div>
          )}

          {/* Body */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="template-body">Body</Label>
              <span
                className={`text-xs ${
                  bodyText.length > BODY_MAX_CHARS
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {bodyText.length}/{BODY_MAX_CHARS}
              </span>
            </div>
            <Textarea
              ref={textareaRef}
              id="template-body"
              placeholder="Hello {{1}}, your order {{2}} has been confirmed."
              rows={4}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={insertVariable}
              >
                <PlusIcon className="size-3" />
                Insert Variable{' '}
                <span className="font-mono text-muted-foreground">
                  {`{{${getNextVariableNumber(bodyText)}}}`}
                </span>
              </Button>
              <span className="text-xs text-muted-foreground">
                Variables are mapped to CSV columns when sending.
              </span>
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
            onClick={() =>
              isEditing ? updateMutation.mutate() : createMutation.mutate()
            }
            disabled={
              isPending ||
              !name ||
              !bodyText ||
              bodyText.length > BODY_MAX_CHARS
            }
          >
            {isPending
              ? isEditing
                ? 'Saving...'
                : 'Creating...'
              : isEditing
                ? 'Save Changes'
                : 'Create Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function TemplatesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [submitTarget, setSubmitTarget] = useState<Template | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['messaging-templates'],
    queryFn: fetchTemplates,
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.templates.sync.$post();
      if (!res.ok) throw new Error('Failed to sync templates');
      return res.json() as Promise<{ synced: number; message?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messaging-templates'] });
      if (data.message) {
        toast.info(data.message);
      } else {
        toast.success(`Synced ${data.synced} templates from Meta`);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await messagingClient.templates[':id'].submit.$post({
        param: { id },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as Record<string, string> | null)?.message ??
            'Failed to submit template',
        );
      }
      return res.json() as Promise<{
        template: Template;
        message?: string;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messaging-templates'] });
      setSubmitTarget(null);
      if (data.message) {
        toast.info(data.message);
      } else {
        toast.success('Template submitted for review');
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await messagingClient.templates[':id'].$delete({
        param: { id },
      });
      if (!res.ok) throw new Error('Failed to delete template');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-templates'] });
      setDeleteTarget(null);
      toast.success('Template deleted');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const columns = createColumns(
    (t) => {
      setEditTemplate(t);
      setDialogOpen(true);
    },
    (t) => setSubmitTarget(t),
    (t) => setDeleteTarget(t),
  );

  const { table } = useDataTable({
    data: data ?? [],
    pageCount: -1,
    columns,
    initialState: {
      sorting: [{ id: 'syncedAt', desc: true }],
    },
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Templates</h2>
          <p className="text-muted-foreground">
            Create and manage WhatsApp message templates for broadcasts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCwIcon
              className={`mr-1.5 size-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
            />
            {syncMutation.isPending ? 'Syncing...' : 'Sync from Meta'}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditTemplate(null);
              setDialogOpen(true);
            }}
          >
            <PlusIcon className="mr-1.5 size-4" />
            New Template
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <DataTableSkeleton
          columnCount={columns.length}
          filterCount={2}
          cellWidths={['12rem', '8rem', '16rem', '8rem', '8rem', '3rem']}
          shrinkZero
        />
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table}>
            <DataTableSortList table={table} />
          </DataTableToolbar>
        </DataTable>
      )}

      {/* Create/Edit dialog */}
      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editTemplate={editTemplate}
      />

      {/* Submit for review confirmation */}
      <AlertDialog
        open={!!submitTarget}
        onOpenChange={(open) => {
          if (!open) setSubmitTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit for review?</AlertDialogTitle>
            <AlertDialogDescription>
              This will submit{' '}
              <span className="font-mono font-medium text-foreground">
                {submitTarget?.name}
              </span>{' '}
              to Meta for approval. The template cannot be edited after
              submission.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                submitTarget && submitMutation.mutate(submitTarget.id)
              }
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <span className="font-mono font-medium text-foreground">
                {deleteTarget?.name}
              </span>
              {deleteTarget?.externalId
                ? ' from both your account and Meta.'
                : '.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/templates/')({
  component: TemplatesPage,
});
