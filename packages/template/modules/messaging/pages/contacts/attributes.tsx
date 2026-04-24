import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeftIcon, GripVerticalIcon, PencilIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { messagingClient } from '@/lib/api-client'

// ─── Types ──────────────────────────────────────────────────────────

interface AttributeDefinition {
  id: string
  key: string
  label: string
  type: string
  showInTable: boolean
  sortOrder: number
  createdAt: string
}

// ─── Data fetching ──────────────────────────────────────────────────

async function fetchAttributeDefinitions(): Promise<AttributeDefinition[]> {
  const res = await messagingClient['attribute-definitions'].$get()
  if (!res.ok) throw new Error('Failed to fetch attribute definitions')
  const json = (await res.json()) as { data: AttributeDefinition[] }
  return json.data
}

// ─── Type labels ────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
}

const TYPE_COLORS: Record<string, string> = {
  text: 'bg-blue-100/30 text-blue-800 dark:text-blue-300 border-blue-200',
  number: 'bg-emerald-100/30 text-emerald-800 dark:text-emerald-300 border-emerald-200',
  boolean: 'bg-amber-100/30 text-amber-800 dark:text-amber-300 border-amber-200',
  date: 'bg-purple-100/30 text-purple-800 dark:text-purple-300 border-purple-200',
}

// ─── Form Dialog ────────────────────────────────────────────────────

function AttributeFormDialog({
  open,
  onOpenChange,
  attribute,
  onSave,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attribute?: AttributeDefinition | null
  onSave: (data: { key: string; label: string; type: string; showInTable: boolean }) => void
  isPending: boolean
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState('text')
  const [showInTable, setShowInTable] = useState(false)
  const isEdit = !!attribute

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setKey(attribute?.key ?? '')
      setLabel(attribute?.label ?? '')
      setType(attribute?.type ?? 'text')
      setShowInTable(attribute?.showInTable ?? false)
    }
    onOpenChange(newOpen)
  }

  // Auto-generate key from label (only in create mode)
  function handleLabelChange(value: string) {
    setLabel(value)
    if (!isEdit) {
      setKey(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
      )
    }
  }

  const canSubmit = key.trim() && label.trim() && !isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit attribute' : 'Create attribute'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="attr-label">Label</Label>
            <Input
              id="attr-label"
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. Company Name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-key">Key</Label>
            <Input
              id="attr-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. company_name"
              disabled={isEdit}
              className={isEdit ? 'opacity-60' : ''}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? 'Key cannot be changed after creation.'
                : 'Lowercase alphanumeric, starting with a letter. Auto-generated from label.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="attr-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="boolean">Boolean</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="attr-show"
              checked={showInTable}
              onCheckedChange={(checked) => setShowInTable(checked === true)}
            />
            <Label htmlFor="attr-show" className="cursor-pointer text-sm">
              Show as column in contacts table
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ key, label, type, showInTable })} disabled={!canSubmit}>
            {isPending ? 'Saving...' : isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ───────────────────────────────────────────────────────────

function AttributeDefinitionsPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAttr, setEditingAttr] = useState<AttributeDefinition | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AttributeDefinition | null>(null)

  const { data: attributes = [], isLoading } = useQuery({
    queryKey: ['attribute-definitions'],
    queryFn: fetchAttributeDefinitions,
  })

  const createMutation = useMutation({
    mutationFn: async (data: { key: string; label: string; type: string; showInTable: boolean }) => {
      const res = await messagingClient['attribute-definitions'].$post(
        {},
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      )
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } }
        throw new Error(err?.error?.message ?? 'Failed to create attribute definition')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribute-definitions'] })
      setDialogOpen(false)
      toast.success('Attribute created')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: {
        label?: string
        type?: string
        showInTable?: boolean
        sortOrder?: number
      }
    }) => {
      const res = await messagingClient['attribute-definitions'][':id'].$put(
        { param: { id } },
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      )
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } }
        throw new Error(err?.error?.message ?? 'Failed to update attribute definition')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribute-definitions'] })
      setDialogOpen(false)
      setEditingAttr(null)
      toast.success('Attribute updated')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await messagingClient['attribute-definitions'][':id'].$delete({
        param: { id },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } }
        throw new Error(err?.error?.message ?? 'Failed to delete attribute definition')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribute-definitions'] })
      setDeleteTarget(null)
      toast.success('Attribute deleted')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  function handleSave(data: { key: string; label: string; type: string; showInTable: boolean }) {
    if (editingAttr) {
      updateMutation.mutate({
        id: editingAttr.id,
        data: {
          label: data.label,
          type: data.type,
          showInTable: data.showInTable,
        },
      })
    } else {
      createMutation.mutate(data)
    }
  }

  function openCreate() {
    setEditingAttr(null)
    setDialogOpen(true)
  }

  function openEdit(attr: AttributeDefinition) {
    setEditingAttr(attr)
    setDialogOpen(true)
  }

  function handleToggleVisibility(attr: AttributeDefinition) {
    updateMutation.mutate({
      id: attr.id,
      data: { showInTable: !attr.showInTable },
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
      {/* Back link */}
      <div>
        <Link
          to="/messaging/contacts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Contacts
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Contact Attributes</h2>
          <p className="text-muted-foreground">
            Define custom attributes for contacts. Visible attributes appear as columns in the contacts table.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="mr-2 h-4 w-4" />
          Add Attribute
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={`skel-${i.toString()}`} className="h-14 w-full rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : attributes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm font-medium">No custom attributes</p>
          <p className="text-sm text-muted-foreground mt-1">Create attributes to add custom fields to your contacts.</p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={openCreate}>
            <PlusIcon className="size-3.5" />
            Create first attribute
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">In Table</TableHead>
                <TableHead className="text-right">Order</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {attributes.map((attr) => (
                <TableRow key={attr.id} className="group">
                  <TableCell>
                    <GripVerticalIcon className="size-4 text-muted-foreground/40" />
                  </TableCell>
                  <TableCell>
                    <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{attr.key}</code>
                  </TableCell>
                  <TableCell className="font-medium">{attr.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TYPE_COLORS[attr.type] ?? ''}>
                      {TYPE_LABELS[attr.type] ?? attr.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={attr.showInTable}
                      onCheckedChange={() => handleToggleVisibility(attr)}
                      disabled={updateMutation.isPending}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{attr.sortOrder}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(attr)}>
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(attr)}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AttributeFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditingAttr(null)
        }}
        attribute={editingAttr}
        onSave={handleSave}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attribute?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the <code className="font-mono text-foreground">{deleteTarget?.key}</code>{' '}
              attribute definition. Existing contact data with this attribute key will not be deleted but will no longer
              have a schema definition.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/messaging/contacts/attributes')({
  component: AttributeDefinitionsPage,
})
