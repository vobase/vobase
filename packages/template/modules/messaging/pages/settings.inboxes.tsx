import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CheckCircle2,
  Globe,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { integrationsClient } from '@/lib/api-client';
import { runWhatsAppEmbeddedSignup } from '@/lib/facebook-sdk';

// ─── Types ───────────────────────────────────────────────────────────

interface InboxData {
  id: string;
  name: string;
  channel: string;
  channelConfig: Record<string, unknown>;
  defaultAgentId: string | null;
  teamId: string | null;
  autoResolveIdleMinutes: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
}

interface WhatsAppChannelConfig {
  phoneNumberId: string;
  wabaId: string;
}

interface InboxFormData {
  name: string;
  channel: string;
  channelConfig: WhatsAppChannelConfig | Record<string, never>;
  defaultAgentId: string;
  teamId: string;
  autoResolveIdleMinutes: number;
}

// ─── Fetchers ────────────────────────────────────────────────────────

async function fetchInboxes(): Promise<InboxData[]> {
  const res = await fetch('/api/messaging/inboxes');
  if (!res.ok) throw new Error('Failed to fetch inboxes');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/messaging/agents');
  if (!res.ok) return [];
  return res.json();
}

async function fetchTeams(): Promise<Team[]> {
  const res = await fetch('/api/messaging/teams');
  if (!res.ok) return [];
  return res.json();
}

// ─── Channel icon ────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  web: Globe,
  whatsapp: MessageCircle,
  email: Mail,
};

const CHANNEL_COLORS: Record<string, string> = {
  web: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  whatsapp:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  email:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

// ─── WhatsApp Connect Section ────────────────────────────────────────

function WhatsAppConnectSection({
  connected,
  onConnected,
}: {
  connected: WhatsAppChannelConfig | null;
  onConnected: (config: WhatsAppChannelConfig) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ['integrations-config'],
    queryFn: async () => {
      const res = await integrationsClient.config.$get();
      return res.json();
    },
  });

  const handleConnect = async () => {
    if (!config?.metaAppId || !config?.metaConfigId) return;
    setConnecting(true);
    setError(null);
    try {
      const { code, wabaId, phoneNumberId } = await runWhatsAppEmbeddedSignup(
        config.metaAppId,
        config.metaConfigId,
      );
      if (!phoneNumberId || !wabaId) {
        setError('WhatsApp signup did not return phone number or WABA ID.');
        return;
      }
      // Exchange code with backend to validate and register credentials
      const res = await fetch('/api/integrations/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, wabaId, phoneNumberId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? 'Failed to connect WhatsApp');
        return;
      }
      onConnected({ phoneNumberId, wabaId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      if (msg !== 'cancelled') setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  if (!config?.metaAppId || !config?.metaConfigId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Setup required</p>
        <p>
          Set{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            META_APP_ID
          </code>
          ,{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            META_APP_SECRET
          </code>
          , and{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            META_CONFIG_ID
          </code>{' '}
          in your{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            .env
          </code>{' '}
          file to enable WhatsApp inboxes.
        </p>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>
          Connected — Phone ID:{' '}
          <span className="font-mono font-medium">
            {connected.phoneNumberId}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting && <Loader2 className="mr-1 size-3 animate-spin" />}
          Reconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleConnect}
        disabled={connecting}
      >
        {connecting ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <MessageCircle className="mr-1.5 size-3.5" />
        )}
        Connect WhatsApp
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A popup will open to authorize your WhatsApp Business account.
      </p>
    </div>
  );
}

// ─── Inbox Form Dialog ──────────────────────────────────────────────

function InboxFormDialog({
  open,
  onOpenChange,
  inbox,
  agents,
  teams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inbox: InboxData | null;
  agents: Agent[];
  teams: Team[];
}) {
  const queryClient = useQueryClient();
  const isEditing = !!inbox;

  const existingWaConfig =
    inbox?.channel === 'whatsapp' &&
    typeof inbox.channelConfig?.phoneNumberId === 'string' &&
    typeof inbox.channelConfig?.wabaId === 'string'
      ? {
          phoneNumberId: inbox.channelConfig.phoneNumberId as string,
          wabaId: inbox.channelConfig.wabaId as string,
        }
      : null;

  const [form, setForm] = useState<InboxFormData>({
    name: inbox?.name ?? '',
    channel: inbox?.channel ?? 'web',
    channelConfig: existingWaConfig ?? {},
    defaultAgentId: inbox?.defaultAgentId ?? '',
    teamId: inbox?.teamId ?? '',
    autoResolveIdleMinutes: inbox?.autoResolveIdleMinutes ?? 120,
  });

  const waConnected =
    form.channel === 'whatsapp' &&
    'phoneNumberId' in form.channelConfig &&
    typeof (form.channelConfig as WhatsAppChannelConfig).phoneNumberId ===
      'string'
      ? (form.channelConfig as WhatsAppChannelConfig)
      : null;

  const canSubmit =
    form.name.trim().length > 0 &&
    (form.channel !== 'whatsapp' || waConnected !== null);

  const mutation = useMutation({
    mutationFn: async (data: InboxFormData) => {
      const url = isEditing
        ? `/api/messaging/inboxes/${inbox.id}`
        : '/api/messaging/inboxes';
      const method = isEditing ? 'PATCH' : 'POST';
      const body = {
        name: data.name,
        channel: data.channel,
        channelConfig: data.channelConfig,
        defaultAgentId: data.defaultAgentId || undefined,
        teamId: data.teamId || undefined,
        autoResolveIdleMinutes: data.autoResolveIdleMinutes,
      };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to save inbox');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-inboxes'] });
      onOpenChange(false);
      toast.success(isEditing ? 'Inbox updated' : 'Inbox created');
    },
    onError: () => {
      toast.error('Failed to save inbox');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Inbox' : 'New Inbox'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update inbox configuration.'
              : 'Create a new inbox for receiving messages.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="inbox-name">Name</Label>
            <Input
              id="inbox-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Support Inbox"
            />
          </div>

          <div className="space-y-2">
            <Label>Channel</Label>
            <Select
              value={form.channel}
              onValueChange={(value) =>
                setForm({ ...form, channel: value, channelConfig: {} })
              }
              disabled={isEditing}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.channel === 'whatsapp' && (
            <div className="space-y-2">
              <Label>WhatsApp Account</Label>
              <WhatsAppConnectSection
                connected={waConnected}
                onConnected={(config) =>
                  setForm({ ...form, channelConfig: config })
                }
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Default Agent</Label>
            <Select
              value={form.defaultAgentId || 'none'}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  defaultAgentId: value === 'none' ? '' : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No agent</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Team</Label>
            <Select
              value={form.teamId || 'none'}
              onValueChange={(value) =>
                setForm({ ...form, teamId: value === 'none' ? '' : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inbox-auto-resolve">
              Auto-resolve after idle (minutes)
            </Label>
            <Input
              id="inbox-auto-resolve"
              type="number"
              min={0}
              value={form.autoResolveIdleMinutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  autoResolveIdleMinutes:
                    Number.parseInt(e.target.value, 10) || 0,
                })
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? 'Saving...' : isEditing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirmation Dialog ──────────────────────────────────────

function DeleteInboxDialog({
  open,
  onOpenChange,
  inbox,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inbox: InboxData;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete inbox</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">{inbox.name}</span>?
            This action cannot be undone. All associated conversations will lose
            their inbox assignment.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Deleting...' : 'Delete inbox'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

function InboxSettingsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInbox, setEditingInbox] = useState<InboxData | null>(null);
  const [deletingInbox, setDeletingInbox] = useState<InboxData | null>(null);

  const { data: inboxes = [], isLoading } = useQuery({
    queryKey: ['messaging-inboxes'],
    queryFn: fetchInboxes,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['messaging-agents'],
    queryFn: fetchAgents,
  });

  const { data: teams = [] } = useQuery({
    queryKey: ['messaging-teams'],
    queryFn: fetchTeams,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/messaging/inboxes/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? 'Failed to delete inbox',
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-inboxes'] });
      setDeletingInbox(null);
      toast.success('Inbox deleted');
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function openCreate() {
    setEditingInbox(null);
    setDialogOpen(true);
  }

  function openEdit(inbox: InboxData) {
    setEditingInbox(inbox);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Inboxes</h2>
          <p className="text-sm text-muted-foreground">
            Manage messaging inboxes and their configuration
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4 mr-1.5" />
          New Inbox
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : inboxes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg gap-3">
          <Inbox className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">No inboxes</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create an inbox to start receiving messages.
            </p>
          </div>
          <Button size="sm" onClick={openCreate} className="mt-1">
            <Plus className="size-4 mr-1.5" />
            New Inbox
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {inboxes.map((inbox) => {
            const ChannelIcon = CHANNEL_ICONS[inbox.channel] ?? Globe;
            return (
              <div
                key={inbox.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`flex items-center justify-center size-7 rounded-md ${CHANNEL_COLORS[inbox.channel] ?? 'bg-muted text-muted-foreground'}`}
                  >
                    <ChannelIcon className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {inbox.name}
                      </p>
                      {!inbox.enabled && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {inbox.defaultAgentId
                        ? `Agent: ${agents.find((a) => a.id === inbox.defaultAgentId)?.name ?? inbox.defaultAgentId}`
                        : 'No default agent'}
                      {inbox.teamId &&
                        ` · Team: ${teams.find((t) => t.id === inbox.teamId)?.name ?? inbox.teamId}`}
                      {' · '}Auto-resolve: {inbox.autoResolveIdleMinutes ?? 120}
                      m
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => openEdit(inbox)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => setDeletingInbox(inbox)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <InboxFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          inbox={editingInbox}
          agents={agents}
          teams={teams}
        />
      )}

      {deletingInbox && (
        <DeleteInboxDialog
          open={!!deletingInbox}
          onOpenChange={(open) => {
            if (!open) setDeletingInbox(null);
          }}
          inbox={deletingInbox}
          onConfirm={() => deleteMutation.mutate(deletingInbox.id)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/settings/inboxes')({
  component: InboxSettingsPage,
});
