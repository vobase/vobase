import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronRightIcon,
  GlobeIcon,
  MailIcon,
  MessageSquareIcon,
  PencilIcon,
  PhoneIcon,
  ShieldOffIcon,
  SmartphoneIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from 'lucide-react'
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
import { Card, CardContent } from '@/components/ui/card'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { messagingClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { ContactFormDialog } from './_components/contact-form-dialog'

// ─── Types ────────────────────────────────────────────────────────────

interface Contact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  role: string
  identifier: string | null
  attributes: Record<string, unknown> | null
  marketingOptOut: boolean
  createdAt: string
  updatedAt: string
}

interface ContactLabel {
  id: string
  title: string
  color: string | null
  description: string | null
  assignedAt: string
}

interface AvailableLabel {
  id: string
  title: string
  color: string | null
  description: string | null
}

interface AttributeDefinition {
  id: string
  key: string
  label: string
  type: string
  showInTable: boolean
  sortOrder: number
}

interface TimelineConversation {
  id: string
  status: string
  outcome: string | null
  reopenCount: number
  onHold: boolean
  priority: string | null
  assignee: string | null
  channelInstanceId: string
  channelType: string
  channelLabel: string
  startedAt: string
  resolvedAt: string | null
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await messagingClient.contacts[':id'].$get({ param: { id } })
  if (!res.ok) throw new Error('Contact not found')
  return res.json() as unknown as Promise<Contact>
}

async function fetchContactLabels(contactId: string): Promise<ContactLabel[]> {
  const res = await messagingClient.contacts[':id'].labels.$get({
    param: { id: contactId },
  })
  if (!res.ok) return []
  return res.json() as unknown as Promise<ContactLabel[]>
}

async function fetchAllLabels(): Promise<AvailableLabel[]> {
  const res = await messagingClient.labels.$get()
  if (!res.ok) return []
  return res.json() as unknown as Promise<AvailableLabel[]>
}

async function fetchAttributeDefinitions(): Promise<AttributeDefinition[]> {
  const res = await messagingClient['attribute-definitions'].$get()
  if (!res.ok) return []
  const json = (await res.json()) as { data: AttributeDefinition[] }
  return json.data
}

async function fetchContactTimeline(contactId: string): Promise<TimelineConversation[]> {
  const res = await messagingClient.contacts[':id'].timeline.$get({
    param: { id: contactId },
    query: { limit: '50' },
  })
  if (!res.ok) return []
  const data = (await res.json()) as unknown as {
    conversations: TimelineConversation[]
  }
  return data.conversations
}

// ─── Helpers ──────────────────────────────────────────────────────────

import { roleColors } from './_lib/helpers'

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'active') return 'default'
  if (status === 'resolved') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'resolving') return 'outline'
  return 'secondary'
}

const CHANNEL_CONFIG: Record<string, { icon: typeof GlobeIcon; color: string; bg: string }> = {
  whatsapp: {
    icon: SmartphoneIcon,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
  },
  email: {
    icon: MailIcon,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  web: {
    icon: GlobeIcon,
    color: 'text-muted-foreground',
    bg: 'bg-muted',
  },
}

function getChannelConfig(type: string) {
  return (
    CHANNEL_CONFIG[type] ?? {
      icon: MessageSquareIcon,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
    }
  )
}

function formatDuration(startStr: string, endStr: string): string {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d`
}

type Tab = 'overview' | 'timeline'

// ─── Overview Tab ────────────────────────────────────────────────────

function OverviewTab({
  contact,
  contactLabels,
  allLabels,
  attrDefs,
  onAddLabel,
  onRemoveLabel,
  onToggleOptOut,
  isLabelPending,
}: {
  contact: Contact
  contactLabels: ContactLabel[]
  allLabels: AvailableLabel[]
  attrDefs: AttributeDefinition[]
  onAddLabel: (labelId: string) => void
  onRemoveLabel: (labelId: string) => void
  onToggleOptOut: (optOut: boolean) => void
  isLabelPending: boolean
}) {
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const assignedIds = new Set(contactLabels.map((l) => l.id))
  const availableLabels = allLabels.filter((l) => !assignedIds.has(l.id))

  const attrs = contact.attributes ?? {}
  const sortedDefs = [...attrDefs].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="space-y-4">
      {/* Identity card */}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <UserIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-semibold">{contact.name ?? contact.identifier ?? contact.id}</h3>
                {contact.identifier && contact.name && (
                  <p className="text-xs text-muted-foreground">{contact.identifier}</p>
                )}
              </div>
            </div>
            <Badge variant="outline" className={cn('capitalize', roleColors[contact.role])}>
              {contact.role}
            </Badge>
          </div>

          <Separator />

          {/* Contact info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {contact.phone && (
              <div className="flex items-center gap-2.5 text-sm">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                  <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span>{contact.phone}</span>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-2.5 text-sm">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                  <MailIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span>{contact.email}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span className="flex items-center gap-1">
                Added <RelativeTimeCard date={contact.createdAt} />
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Labels */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <TagIcon className="h-3.5 w-3.5" />
              Labels
            </h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowLabelPicker(!showLabelPicker)}
            >
              {showLabelPicker ? 'Done' : '+ Add'}
            </Button>
          </div>
          {contactLabels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {contactLabels.map((label) => (
                <Badge key={label.id} variant="outline" className="gap-1 pl-1.5">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color ?? '#6b7280' }}
                  />
                  {label.title}
                  <button
                    type="button"
                    onClick={() => onRemoveLabel(label.id)}
                    className="ml-0.5 hover:text-destructive"
                    disabled={isLabelPending}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No labels assigned.</p>
          )}
          {showLabelPicker && availableLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t">
              {availableLabels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => onAddLabel(label.id)}
                  disabled={isLabelPending}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted transition-colors"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color ?? '#6b7280' }}
                  />
                  {label.title}
                </button>
              ))}
            </div>
          )}
          {showLabelPicker && availableLabels.length === 0 && (
            <p className="text-xs text-muted-foreground pt-1 border-t">All labels assigned.</p>
          )}
        </CardContent>
      </Card>

      {/* Custom Attributes */}
      {sortedDefs.length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <h4 className="text-sm font-medium">Custom Attributes</h4>
            <div className="grid grid-cols-2 gap-2">
              {sortedDefs.map((def) => {
                const value = attrs[def.key]
                const hasValue = value !== undefined && value !== null && value !== ''
                return (
                  <div key={def.key} className="rounded-md bg-muted/50 px-2.5 py-1.5">
                    <p className="text-xs text-muted-foreground">{def.label}</p>
                    <p className="text-sm font-medium truncate">
                      {hasValue ? (
                        def.type === 'boolean' ? (
                          value === true ? (
                            'Yes'
                          ) : (
                            'No'
                          )
                        ) : (
                          String(value)
                        )
                      ) : (
                        <span className="text-muted-foreground/40">&mdash;</span>
                      )}
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Marketing Opt-out */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                <ShieldOffIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Marketing Opt-out</p>
                <p className="text-xs text-muted-foreground">
                  {contact.marketingOptOut
                    ? 'This contact has opted out of marketing messages.'
                    : 'This contact can receive marketing messages.'}
                </p>
              </div>
            </div>
            <Switch checked={contact.marketingOptOut} onCheckedChange={onToggleOptOut} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Timeline Tab ───────────────────────────────────────────────────

function TimelineTab({ contactId }: { contactId: string }) {
  const { data: timeline = [], isLoading } = useQuery({
    queryKey: ['contacts-timeline', contactId],
    queryFn: () => fetchContactTimeline(contactId),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {['t1', 't2', 't3'].map((k) => (
          <Skeleton key={k} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (timeline.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 py-8 text-center">
        <MessageSquareIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {timeline.map((conv) => (
        <ConversationCard key={conv.id} conversation={conv} contactId={contactId} />
      ))}
    </div>
  )
}

function ConversationCard({ conversation, contactId }: { conversation: TimelineConversation; contactId: string }) {
  const channel = getChannelConfig(conversation.channelType)
  const ChannelIcon = channel.icon
  const duration = conversation.resolvedAt ? formatDuration(conversation.startedAt, conversation.resolvedAt) : null

  return (
    <div className="group rounded-lg border bg-background transition-colors hover:bg-muted/20">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${channel.bg}`}>
          <ChannelIcon className={`h-3.5 w-3.5 ${channel.color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{`${conversation.channelLabel} conversation`}</span>
            {conversation.reopenCount > 0 && (
              <span className="text-[10px] text-muted-foreground">reopened {conversation.reopenCount}x</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RelativeTimeCard date={conversation.startedAt} />
            {duration && (
              <>
                <span>&middot;</span>
                <span>{duration}</span>
              </>
            )}
            <span>&middot;</span>
            <span className="capitalize">{conversation.channelType}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant={statusVariant(conversation.status)} className="text-[10px] capitalize">
            {conversation.status}
          </Badge>
          {conversation.outcome && conversation.status === 'resolved' && (
            <Badge variant="secondary" className="text-[10px] capitalize">
              {conversation.outcome.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end border-t px-4 py-2 text-[11px] text-muted-foreground">
        <Link
          to="/messaging/inbox/$contactId"
          params={{ contactId }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        >
          Open &rarr;
        </Link>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────

function ContactDetailPage() {
  const { contactId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const {
    data: contact,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => fetchContact(contactId),
  })

  const { data: contactLabels = [] } = useQuery({
    queryKey: ['contacts', contactId, 'labels'],
    queryFn: () => fetchContactLabels(contactId),
    enabled: !!contact,
  })

  const { data: allLabels = [] } = useQuery({
    queryKey: ['labels'],
    queryFn: fetchAllLabels,
    staleTime: 300_000,
  })

  const { data: attrDefs = [] } = useQuery({
    queryKey: ['attribute-definitions'],
    queryFn: fetchAttributeDefinitions,
    staleTime: 300_000,
  })

  const invalidateContact = () => {
    queryClient.invalidateQueries({ queryKey: ['contacts', contactId] })
  }

  const updateMutation = useMutation({
    mutationFn: async (data: { name?: string; phone?: string; email?: string; identifier?: string; role: string }) => {
      const res = await messagingClient.contacts[':id'].$patch(
        { param: { id: contactId } },
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      )
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } }
        throw new Error(err?.error?.message ?? 'Failed to update contact')
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateContact()
      setEditDialogOpen(false)
      toast.success('Contact updated')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.contacts[':id'].$delete({
        param: { id: contactId },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } }
        throw new Error(err?.error?.message ?? 'Failed to delete contact')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Contact deleted')
      navigate({ to: '/messaging/contacts' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const addLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      const res = await messagingClient.contacts[':id'].labels.$post(
        { param: { id: contactId } },
        {
          init: {
            body: JSON.stringify({ labelIds: [labelId] }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      )
      if (!res.ok) throw new Error('Failed to add label')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['contacts', contactId, 'labels'],
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const removeLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      const res = await messagingClient.contacts[':id'].labels[':labelId'].$delete({
        param: { id: contactId, labelId },
      })
      if (!res.ok) throw new Error('Failed to remove label')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['contacts', contactId, 'labels'],
      })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const optOutMutation = useMutation({
    mutationFn: async (optOut: boolean) => {
      const res = await messagingClient.contacts[':id']['marketing-opt-out'].$put(
        { param: { id: contactId } },
        {
          init: {
            body: JSON.stringify({ optOut }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      )
      if (!res.ok) throw new Error('Failed to update opt-out')
      return res.json()
    },
    onSuccess: () => {
      invalidateContact()
      toast.success('Marketing preference updated')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (isError || !contact) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Contact not found.</p>
        <Link
          to="/messaging/contacts"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to contacts
        </Link>
      </div>
    )
  }

  const displayName = contact.name ?? contact.identifier ?? contact.id

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'timeline', label: 'Timeline' },
  ]

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/messaging/contacts" className="hover:text-foreground transition-colors">
            Contacts
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" />
          <span className="text-foreground font-medium">{displayName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
            <PencilIcon className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <TrashIcon className="mr-2 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant="ghost"
            size="sm"
            className={`rounded-none border-b-2 px-3 text-sm ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          contact={contact}
          contactLabels={contactLabels}
          allLabels={allLabels}
          attrDefs={attrDefs}
          onAddLabel={(labelId) => addLabelMutation.mutate(labelId)}
          onRemoveLabel={(labelId) => removeLabelMutation.mutate(labelId)}
          onToggleOptOut={(optOut) => optOutMutation.mutate(optOut)}
          isLabelPending={addLabelMutation.isPending || removeLabelMutation.isPending}
        />
      )}
      {activeTab === 'timeline' && <TimelineTab contactId={contact.id} />}

      {/* Edit dialog */}
      <ContactFormDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        contact={contact}
        onSave={(data) => updateMutation.mutate(data)}
        isPending={updateMutation.isPending}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{displayName}</span> and remove
              all their labels. Contacts with active conversations cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
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

export const Route = createFileRoute('/_app/messaging/contacts/$contactId')({
  component: ContactDetailPage,
})
