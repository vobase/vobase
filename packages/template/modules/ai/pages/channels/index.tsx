import {
  IconBrandInstagram,
  IconBrandMessenger,
  IconBrandTelegram,
  IconBrandWhatsapp,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  GlobeIcon,
  MailIcon,
  MessageCircleIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { aiClient } from '@/lib/api-client';
import { runWhatsAppEmbeddedSignup } from '@/lib/facebook-sdk';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

interface ChannelInstance {
  id: string;
  type: string;
  label: string;
  source: string;
  status: string;
  integrationId: string | null;
  config: Record<string, unknown>;
  createdAt: string;
}

interface ChannelRouting {
  id: string;
  name: string;
  channelInstanceId: string;
  agentId: string;
  assignmentPattern: string;
  enabled: boolean;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
}

interface ChannelStatus {
  id: string;
  type: string;
  label: string;
  status: string;
  activeSessionCount: number;
}

interface ChannelsConfig {
  metaAppId: string | null;
  metaConfigId: string | null;
  platformUrl: string | null;
}

// ─── Dialog mode ──────────────────────────────────────────────────────

type DialogMode =
  | {
      kind: 'new-whatsapp';
      code: string;
      wabaId?: string;
      phoneNumberId?: string;
    }
  | { kind: 'new-web' }
  | {
      kind: 'complete-setup';
      instanceId: string;
      defaultName: string;
      channelType: string;
    };

// ─── Channel type definitions ────────────────────────────────────────

const CHANNEL_TYPES = [
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    description: 'Let customers message you on WhatsApp',
    placeholder: 'e.g. Main WhatsApp Line',
    icon: IconBrandWhatsapp,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950/30',
    borderColor: 'border-l-green-500',
  },
  {
    type: 'web',
    name: 'Website Chat',
    description: 'Add an AI chat widget to your website',
    placeholder: 'e.g. Website Chat',
    icon: GlobeIcon,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    borderColor: 'border-l-blue-500',
  },
  {
    type: 'messenger',
    name: 'Messenger',
    description: 'Connect your Facebook Messenger',
    placeholder: 'e.g. Business Messenger',
    icon: IconBrandMessenger,
    color: 'text-blue-500 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    borderColor: 'border-l-blue-500',
  },
  {
    type: 'instagram',
    name: 'Instagram',
    description: 'Respond to Instagram DMs with AI',
    placeholder: 'e.g. Instagram DMs',
    icon: IconBrandInstagram,
    color: 'text-pink-600 dark:text-pink-400',
    bgColor: 'bg-pink-50 dark:bg-pink-950/30',
    borderColor: 'border-l-pink-500',
  },
  {
    type: 'telegram',
    name: 'Telegram',
    description: 'Connect a Telegram bot for customer chat',
    placeholder: 'e.g. Support Bot',
    icon: IconBrandTelegram,
    color: 'text-sky-600 dark:text-sky-400',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    borderColor: 'border-l-sky-500',
    comingSoon: true,
  },
  {
    type: 'email',
    name: 'Email',
    description: 'Handle customer emails with AI',
    placeholder: 'e.g. Support Email',
    icon: MailIcon,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-900/30',
    borderColor: 'border-l-gray-500',
    comingSoon: true,
  },
  {
    type: 'voice',
    name: 'Voice',
    description: 'Answer calls with an AI voice agent',
    placeholder: 'e.g. Phone Line',
    icon: MicIcon,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    borderColor: 'border-l-purple-500',
    comingSoon: true,
  },
] as const;

function getChannelMeta(type: string) {
  return (
    CHANNEL_TYPES.find((ct) => ct.type === type) ?? {
      type,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      description: '',
      placeholder: 'e.g. My Channel',
      icon: GlobeIcon,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted/30',
      borderColor: 'border-l-muted-foreground',
    }
  );
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchInstances(): Promise<ChannelInstance[]> {
  const res = await aiClient.instances.$get();
  if (!res.ok) throw new Error('Failed to fetch channels');
  return res.json() as unknown as Promise<ChannelInstance[]>;
}

async function fetchChannelRoutings(): Promise<ChannelRouting[]> {
  const res = await aiClient['channel-routings'].$get();
  if (!res.ok) throw new Error('Failed to fetch channel routings');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await aiClient.agents.$get();
  if (!res.ok) return [];
  return res.json();
}

async function fetchChannelStatus(): Promise<{ channels: ChannelStatus[] }> {
  const res = await aiClient.channels.status.$get();
  if (!res.ok) return { channels: [] };
  return res.json();
}

async function fetchChannelsConfig(): Promise<ChannelsConfig> {
  const res = await aiClient.channels.config.$get();
  if (!res.ok)
    return { metaAppId: null, metaConfigId: null, platformUrl: null };
  return res.json() as unknown as Promise<ChannelsConfig>;
}

// ─── Connect Dialog ──────────────────────────────────────────────────

function ConnectDialog({
  mode,
  agents,
  open,
  onOpenChange,
  onCreated,
}: {
  mode: DialogMode | null;
  agents: Agent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');

  // Reset form when dialog opens/mode changes
  const stableKey = mode
    ? `${mode.kind}-${mode.kind === 'complete-setup' ? mode.instanceId : ''}`
    : 'closed';

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset form state when mode changes
  useEffect(() => {
    if (mode) {
      setName(
        mode.kind === 'complete-setup'
          ? mode.defaultName
          : mode.kind === 'new-whatsapp'
            ? 'WhatsApp'
            : '',
      );
      setAgentId('');
    }
  }, [stableKey]);

  const channelType =
    mode?.kind === 'new-whatsapp'
      ? 'whatsapp'
      : mode?.kind === 'complete-setup'
        ? mode.channelType
        : 'web';
  const meta = getChannelMeta(channelType);
  const Icon = meta.icon;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!mode) throw new Error('No mode');

      if (mode.kind === 'new-whatsapp') {
        const res = await aiClient.channels.whatsapp.connect.$post({
          json: {
            code: mode.code,
            wabaId: mode.wabaId,
            phoneNumberId: mode.phoneNumberId,
            name,
            agentId,
          },
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(data.error?.message ?? 'Failed to connect WhatsApp');
        }
        return res.json();
      }

      if (mode.kind === 'new-web') {
        const instanceRes = await aiClient.instances.$post({
          json: { type: 'web', label: name, source: 'env' as const },
        });
        if (!instanceRes.ok) throw new Error('Failed to create channel');
        const instance =
          (await instanceRes.json()) as unknown as ChannelInstance;

        try {
          const routingRes = await aiClient['channel-routings'].$post({
            json: {
              name,
              channelInstanceId: instance.id,
              agentId,
              assignmentPattern: 'direct',
            },
          });
          if (!routingRes.ok)
            throw new Error('Failed to connect channel to agent');
          return routingRes.json();
        } catch (err) {
          await aiClient.instances[':id']
            .$delete({ param: { id: instance.id } })
            .catch(() => {});
          throw err;
        }
      }

      if (mode.kind === 'complete-setup') {
        // biome-ignore lint/style/noRestrictedGlobals: complete-setup endpoint not typed in RPC client
        const res = await fetch(
          `/api/ai/instances/${mode.instanceId}/complete-setup`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, agentId }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(data.error?.message ?? 'Failed to complete setup');
        }
        return res.json();
      }

      throw new Error('Unknown mode');
    },
    onSuccess: () => {
      onOpenChange(false);
      setName('');
      setAgentId('');
      onCreated();
    },
  });

  const title =
    mode?.kind === 'complete-setup'
      ? 'Complete Setup'
      : mode?.kind === 'new-whatsapp'
        ? 'Connect WhatsApp'
        : 'Connect Website Chat';

  const description =
    mode?.kind === 'complete-setup'
      ? 'Choose a name and assign an AI agent to activate this channel'
      : meta.description;

  const submitLabel = mutation.isPending
    ? mode?.kind === 'complete-setup'
      ? 'Saving...'
      : 'Connecting...'
    : mode?.kind === 'complete-setup'
      ? 'Complete Setup'
      : 'Connect Channel';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setName('');
          setAgentId('');
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md" key={stableKey}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn('rounded-lg p-2', meta.bgColor)}>
              <Icon className={cn('h-6 w-6', meta.color)} />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Channel Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={meta.placeholder}
            />
            <p className="text-xs text-muted-foreground">
              A friendly name to help you identify this channel
            </p>
          </div>
          <div className="space-y-2">
            <Label>AI Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose which AI handles this channel..." />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The AI agent that will respond to customers on this channel
            </p>
          </div>
        </div>
        {mutation.isError && (
          <p className="text-xs text-destructive">{mutation.error.message}</p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !agentId || mutation.isPending}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Connected Channel Card ─────────────────────────────────────────

function ChannelCard({
  routing,
  instance,
  agentName,
  activeConversations,
  onToggle,
  onDelete,
  isToggling,
}: {
  routing: ChannelRouting;
  instance: ChannelInstance | undefined;
  agentName: string;
  activeConversations: number;
  onToggle: () => void;
  onDelete: () => void;
  isToggling: boolean;
}) {
  const type = instance?.type ?? 'web';
  const meta = getChannelMeta(type);
  const Icon = meta.icon;
  const { copy, isCopied } = useCopyToClipboard();

  const chatLink =
    type === 'web' ? `${window.location.origin}/chat/${routing.id}` : null;

  function handleCopyLink() {
    if (chatLink) copy(chatLink, { timeout: 2000 });
  }

  return (
    <Card
      className={cn(
        'border-l-4 transition-colors',
        meta.borderColor,
        !routing.enabled && 'opacity-60',
      )}
    >
      <CardContent className="flex items-start gap-4 py-4">
        <div className={cn('rounded-lg p-3 shrink-0', meta.bgColor)}>
          <Icon className={cn('h-6 w-6', meta.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium truncate">{routing.name}</h3>
            <Badge
              variant={routing.enabled ? 'success' : 'secondary'}
              className="text-xs shrink-0"
            >
              {routing.enabled ? 'Connected' : 'Paused'}
            </Badge>
          </div>

          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <BotIcon className="h-3 w-3" />
                {agentName}
              </span>
              {activeConversations > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  {activeConversations} active{' '}
                  {activeConversations === 1 ? 'conversation' : 'conversations'}
                </span>
              )}
            </div>
            {type === 'whatsapp' && instance?.label && (
              <span className="font-mono text-foreground/60">
                {instance.label.replace(/^WhatsApp\s*/i, '')}
              </span>
            )}
            {chatLink && (
              <span className="font-mono text-foreground/60 truncate">
                {chatLink.replace(/^https?:\/\//, '')}
              </span>
            )}
          </div>

          {chatLink && routing.enabled && (
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleCopyLink}
              >
                {isCopied ? (
                  <>
                    <CheckIcon className="h-3 w-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <CopyIcon className="h-3 w-3" />
                    Copy chat link
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
              <EllipsisVerticalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onToggle} disabled={isToggling}>
              {routing.enabled ? (
                <>
                  <PauseIcon className="h-4 w-4 mr-2" />
                  Pause Channel
                </>
              ) : (
                <>
                  <PlayIcon className="h-4 w-4 mr-2" />
                  Resume Channel
                </>
              )}
            </DropdownMenuItem>
            {chatLink && (
              <DropdownMenuItem onClick={handleCopyLink}>
                <CopyIcon className="h-4 w-4 mr-2" />
                Copy Chat Link
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              Remove Channel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

// ─── Needs Setup Card ───────────────────────────────────────────────

function NeedsSetupCard({
  instance,
  onCompleteSetup,
}: {
  instance: ChannelInstance;
  onCompleteSetup: () => void;
}) {
  const meta = getChannelMeta(instance.type);
  const Icon = meta.icon;

  const sourceLabel =
    instance.source === 'platform'
      ? 'Platform'
      : instance.source === 'sandbox'
        ? 'Sandbox'
        : 'Self';

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardContent className="flex items-center gap-4 py-4">
        <div className={cn('rounded-lg p-3 shrink-0', meta.bgColor)}>
          <Icon className={cn('h-6 w-6', meta.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium truncate">{instance.label}</h3>
            <Badge
              variant="outline"
              className="text-xs shrink-0 border-amber-400 text-amber-700 dark:text-amber-400"
            >
              Needs Setup
            </Badge>
            <Badge variant="secondary" className="text-xs shrink-0">
              {sourceLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Assign an AI agent to activate this channel
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onCompleteSetup}
        >
          Complete Setup
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Add Channel Card ───────────────────────────────────────────────

function AddChannelCard({
  type,
  existingCount,
  onClick,
}: {
  type: (typeof CHANNEL_TYPES)[number];
  existingCount: number;
  onClick: () => void;
}) {
  const Icon = type.icon;
  const comingSoon = 'comingSoon' in type && type.comingSoon;

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-colors',
        comingSoon ? 'opacity-70' : 'group hover:border-foreground/20',
      )}
    >
      {comingSoon && (
        <div className="absolute top-0 right-0 bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground rounded-bl-md border-b border-l">
          Coming Soon
        </div>
      )}
      <CardContent className="flex items-center gap-4 py-4">
        <div className={cn('rounded-lg p-3 shrink-0', type.bgColor)}>
          <Icon className={cn('h-6 w-6', type.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium">{type.name}</h3>
          <p className="text-xs text-muted-foreground">{type.description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={onClick}
          disabled={comingSoon}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {existingCount > 0 ? 'Add Another' : 'Connect'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Delete Confirmation ────────────────────────────────────────────

function DeleteChannelDialog({
  channelName,
  open,
  onOpenChange,
  onConfirm,
  isPending,
  error,
}: {
  channelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove channel?</AlertDialogTitle>
          <AlertDialogDescription>
            This will disconnect <strong>{channelName}</strong> and remove all
            its conversation history. Customers will no longer be able to reach
            you through this channel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {error ? 'Close' : 'Keep Channel'}
          </AlertDialogCancel>
          {!error && (
            <Button
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
              disabled={isPending}
              variant="destructive"
            >
              {isPending ? 'Removing...' : 'Remove Channel'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function ChannelsPage() {
  const queryClient = useQueryClient();

  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    instanceId: string;
    name: string;
  } | null>(null);

  const { data: instances = [], isLoading: instancesLoading } = useQuery({
    queryKey: ['channel-instances'],
    queryFn: fetchInstances,
  });

  const { data: routings = [], isLoading: routingsLoading } = useQuery({
    queryKey: ['channel-routings'],
    queryFn: fetchChannelRoutings,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['conversations-agents'],
    queryFn: fetchAgents,
  });

  const { data: channelStatusData } = useQuery({
    queryKey: ['conversations-channel-status'],
    queryFn: fetchChannelStatus,
  });

  const { data: config } = useQuery({
    queryKey: ['channels-config'],
    queryFn: fetchChannelsConfig,
  });

  const isLoading = instancesLoading || routingsLoading;

  const sessionCountMap = useMemo(
    () =>
      new Map(
        (channelStatusData?.channels ?? []).map((ch) => [
          ch.id,
          ch.activeSessionCount,
        ]),
      ),
    [channelStatusData],
  );

  const instanceMap = useMemo(
    () => new Map(instances.map((i) => [i.id, i])),
    [instances],
  );

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );

  const typeCountMap = useMemo(
    () =>
      instances.reduce<Record<string, number>>((acc, inst) => {
        acc[inst.type] = (acc[inst.type] ?? 0) + 1;
        return acc;
      }, {}),
    [instances],
  );

  const routingsByInstance = useMemo(() => {
    const map = new Map<string, ChannelRouting[]>();
    for (const r of routings) {
      const list = map.get(r.channelInstanceId) ?? [];
      list.push(r);
      map.set(r.channelInstanceId, list);
    }
    return map;
  }, [routings]);

  const connectedChannels = useMemo(
    () =>
      routings.map((r) => ({
        routing: r,
        instance: instanceMap.get(r.channelInstanceId),
        agentName: agentMap.get(r.agentId) ?? 'Unknown Agent',
        activeConversations: sessionCountMap.get(r.channelInstanceId) ?? 0,
      })),
    [routings, instanceMap, agentMap, sessionCountMap],
  );

  const needsSetupInstances = useMemo(
    () => instances.filter((i) => !routingsByInstance.has(i.id)),
    [instances, routingsByInstance],
  );

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['channel-instances'] });
    queryClient.invalidateQueries({ queryKey: ['channel-routings'] });
    queryClient.invalidateQueries({
      queryKey: ['conversations-channel-status'],
    });
  }

  async function handleAddChannel(type: string) {
    setConnectError(null);

    if (type === 'whatsapp') {
      // Platform-managed: redirect to platform OAuth proxy
      if (!config?.metaAppId && config?.platformUrl) {
        const slug =
          import.meta.env.VITE_PLATFORM_TENANT_SLUG ||
          window.location.hostname.split('.')[0];
        window.location.href = `${config.platformUrl}/api/oauth-proxy/whatsapp/connect?tenant=${slug}`;
        return;
      }

      if (!config?.metaAppId || !config?.metaConfigId) {
        setConnectError(
          'META_APP_ID and META_CONFIG_ID must be set in your environment before connecting WhatsApp.',
        );
        return;
      }

      setConnectingType('whatsapp');
      try {
        const { code, wabaId, phoneNumberId } = await runWhatsAppEmbeddedSignup(
          config.metaAppId,
          config.metaConfigId,
        );
        setDialogMode({ kind: 'new-whatsapp', code, wabaId, phoneNumberId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        if (msg !== 'cancelled') setConnectError(msg);
      } finally {
        setConnectingType(null);
      }
      return;
    }

    // Meta channels (messenger, instagram): same platform redirect as WhatsApp
    if (type === 'messenger' || type === 'instagram') {
      const platformUrl = config?.platformUrl;
      if (!platformUrl) {
        setConnectError(
          `${getChannelMeta(type).name} requires platform integration. Configure PLATFORM_URL to connect.`,
        );
        return;
      }
      const slug =
        import.meta.env.VITE_PLATFORM_TENANT_SLUG ||
        window.location.hostname.split('.')[0];
      window.location.href = `${platformUrl}/api/oauth-proxy/${type}/connect?tenant=${slug}`;
      return;
    }

    if (type === 'web') {
      setDialogMode({ kind: 'new-web' });
      return;
    }

    // telegram / email / voice: coming soon
    setConnectError(`${getChannelMeta(type).name} channels are coming soon.`);
  }

  const toggleMutation = useMutation({
    mutationFn: async ({
      routingId,
      enabled,
    }: {
      routingId: string;
      enabled: boolean;
    }) => {
      // biome-ignore lint/style/noRestrictedGlobals: PATCH body not typed in RPC client
      const res = await fetch(`/api/ai/channel-routings/${routingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to update channel');
      return res.json();
    },
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      const res = await aiClient.instances[':id'].$delete({
        param: { id: instanceId },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = data as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Failed to remove channel');
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateAll();
    },
  });

  return (
    <div className="flex flex-col gap-8 p-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Channels</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage where your customers can reach your AI agent
        </p>
      </div>

      {/* Error banner */}
      {connectError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {connectError}
        </div>
      )}

      {/* Your Channels */}
      <section>
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Your Channels
        </h2>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-[88px] rounded-lg" />
            <Skeleton className="h-[88px] rounded-lg" />
          </div>
        )}

        {!isLoading && connectedChannels.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <MessageCircleIcon className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium mb-1">
                No channels connected yet
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Connect a channel below so your customers can start chatting
                with your AI agent on WhatsApp, your website, or email.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && connectedChannels.length > 0 && (
          <div className="space-y-3">
            {connectedChannels.map(
              ({ routing, instance, agentName, activeConversations }) => (
                <ChannelCard
                  key={routing.id}
                  routing={routing}
                  instance={instance}
                  agentName={agentName}
                  activeConversations={activeConversations}
                  isToggling={toggleMutation.isPending}
                  onToggle={() =>
                    toggleMutation.mutate({
                      routingId: routing.id,
                      enabled: !routing.enabled,
                    })
                  }
                  onDelete={() =>
                    setDeleteTarget({
                      instanceId: routing.channelInstanceId,
                      name: routing.name,
                    })
                  }
                />
              ),
            )}
          </div>
        )}
      </section>

      {/* Needs Setup */}
      {!isLoading && needsSetupInstances.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <TriangleAlertIcon className="h-3.5 w-3.5 text-amber-500" />
            Needs Setup
          </h2>
          <div className="space-y-3">
            {needsSetupInstances.map((instance) => (
              <NeedsSetupCard
                key={instance.id}
                instance={instance}
                onCompleteSetup={() =>
                  setDialogMode({
                    kind: 'complete-setup',
                    instanceId: instance.id,
                    defaultName: instance.label,
                    channelType: instance.type,
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Add a Channel */}
      <section>
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Add a Channel
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CHANNEL_TYPES.map((type) => (
            <AddChannelCard
              key={type.type}
              type={type}
              existingCount={typeCountMap[type.type] ?? 0}
              onClick={() => handleAddChannel(type.type)}
            />
          ))}
        </div>
        {connectingType === 'whatsapp' && (
          <p className="mt-3 text-xs text-muted-foreground animate-pulse">
            Opening WhatsApp signup...
          </p>
        )}
      </section>

      <ConnectDialog
        mode={dialogMode}
        agents={agents}
        open={!!dialogMode}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null);
        }}
        onCreated={invalidateAll}
      />

      <DeleteChannelDialog
        channelName={deleteTarget?.name ?? ''}
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            deleteMutation.reset();
          }
        }}
        onConfirm={() =>
          deleteTarget && deleteMutation.mutate(deleteTarget.instanceId)
        }
        isPending={deleteMutation.isPending}
        error={deleteMutation.isError ? deleteMutation.error.message : null}
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/channels')({
  component: ChannelsPage,
});
