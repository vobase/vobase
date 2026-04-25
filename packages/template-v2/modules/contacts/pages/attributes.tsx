import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AttributeFormDialog, type AttributeFormValues } from '../components/attribute-form-dialog'
import {
  useAttributeDefinitions,
  useCreateDefinition,
  useDeleteDefinition,
  useUpdateDefinition,
} from '../hooks/use-attributes'
import type { AttributeType, ContactAttributeDefinition } from '../schema'

const TYPE_LABEL: Record<AttributeType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / No',
  date: 'Date',
  enum: 'Choice list',
}

export function AttributeDefinitionsPage() {
  const { data: defs = [], isLoading } = useAttributeDefinitions()
  const create = useCreateDefinition()
  const update = useUpdateDefinition()
  const remove = useDeleteDefinition()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ContactAttributeDefinition | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContactAttributeDefinition | null>(null)

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(def: ContactAttributeDefinition) {
    setEditing(def)
    setDialogOpen(true)
  }

  async function handleSave(values: AttributeFormValues) {
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            label: values.label,
            type: values.type,
            options: values.options,
            showInTable: values.showInTable,
          },
        })
        toast.success('Attribute updated')
      } else {
        await create.mutateAsync({
          key: values.key,
          label: values.label,
          type: values.type,
          options: values.options,
          showInTable: values.showInTable,
        })
        toast.success('Attribute created')
      }
      setDialogOpen(false)
      setEditing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleToggleVisibility(def: ContactAttributeDefinition) {
    try {
      await update.mutateAsync({ id: def.id, patch: { showInTable: !def.showInTable } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success('Attribute deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-border border-b px-6 py-4">
        <Button asChild size="sm" variant="ghost">
          <Link to="/contacts">
            <ArrowLeft className="mr-1 size-4" />
            Contacts
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="font-semibold text-lg tracking-tight">Contact attributes</h1>
          <p className="text-muted-foreground text-xs">
            Custom fields shown on every contact. Turn on "show in list" to surface as a contacts-table column.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 size-4" />
          New attribute
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && <div className="text-muted-foreground text-sm">Loading attributes…</div>}
        {!isLoading && defs.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <Empty>
              <EmptyMedia>
                <Tag className="size-5" />
              </EmptyMedia>
              <EmptyTitle>No custom attributes yet</EmptyTitle>
              <EmptyDescription>
                Add attributes like "Company", "Birthday" or "Lead source" to keep consistent info on every contact.
              </EmptyDescription>
              <div className="mt-3">
                <Button size="sm" onClick={openCreate}>
                  <Plus className="mr-1 size-4" />
                  New attribute
                </Button>
              </div>
            </Empty>
          </div>
        )}
        {!isLoading && defs.length > 0 && (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Choices</TableHead>
                  <TableHead className="text-center">Show in list</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {defs.map((def) => (
                  <TableRow key={def.id} className="group">
                    <TableCell className="font-medium">{def.label}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{def.key}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {TYPE_LABEL[def.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {def.type === 'enum' && def.options.length > 0 ? def.options.join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={def.showInTable}
                        onCheckedChange={() => {
                          void handleToggleVisibility(def)
                        }}
                        disabled={update.isPending}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(def)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(def)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AttributeFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
        attribute={editing}
        onSave={handleSave}
        isPending={create.isPending || update.isPending}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this attribute?</AlertDialogTitle>
            <AlertDialogDescription>
              The <code className="font-mono text-foreground">{deleteTarget?.key}</code> field will be removed from the
              contacts form. Existing values stored on contacts are kept but will no longer appear.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/contacts/attributes')({
  component: AttributeDefinitionsPage,
})
