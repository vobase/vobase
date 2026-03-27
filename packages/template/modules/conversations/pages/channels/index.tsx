import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CableIcon,
  ExternalLinkIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  PlusIcon,
  RadioIcon,
  TrashIcon,
} from 'lucide-react';
import { useState } from 'react';

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
  DialogTrigger,
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { conversationsClient } from '@/lib/api-client';

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

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchInstances(): Promise<ChannelInstance[]> {
  const res = await conversationsClient.instances.$get();
  if (!res.ok) throw new Error('Failed to fetch instances');
  return res.json() as unknown as Promise<ChannelInstance[]>;
}

async function fetchChannelRoutings(): Promise<ChannelRouting[]> {
  const res = await conversationsClient['channel-routings'].$get();
  if (!res.ok) throw new Error('Failed to fetch channel routings');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await conversationsClient.agents.$get();
  if (!res.ok) return [];
  return res.json();
}

interface ChannelStatus {
  id: string;
  type: string;
  label: string;
  status: string;
  activeSessionCount: number;
}

async function fetchChannelStatus(): Promise<{ channels: ChannelStatus[] }> {
  const res = await conversationsClient.channels.status.$get();
  if (!res.ok) return { channels: [] };
  return res.json();
}

async function createInstance(
  data: Pick<ChannelInstance, 'type' | 'label' | 'source'>,
): Promise<ChannelInstance> {
  const res = await conversationsClient.instances.$post({ json: data });
  if (!res.ok) throw new Error('Failed to create instance');
  return res.json() as unknown as Promise<ChannelInstance>;
}

async function deleteInstance(id: string): Promise<void> {
  const res = await conversationsClient.instances[':id'].$delete({
    param: { id },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { message?: string }).message ?? 'Failed to delete instance',
    );
  }
}

async function createChannelRouting(data: {
  name: string;
  channelInstanceId: string;
  agentId: string;
  assignmentPattern: string;
}): Promise<ChannelRouting> {
  const res = await conversationsClient['channel-routings'].$post({
    json: data,
  });
  if (!res.ok) throw new Error('Failed to create channel routing');
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, typeof PhoneIcon> = {
  whatsapp: PhoneIcon,
  web: MessageSquareIcon,
  email: MailIcon,
  voice: RadioIcon,
};

function channelIcon(type: string) {
  return CHANNEL_ICONS[type] ?? CableIcon;
}

function sourceVariant(source: string): 'default' | 'secondary' | 'outline' {
  if (source === 'env') return 'secondary';
  if (source === 'platform') return 'default';
  return 'outline';
}

function statusDot(status: string): string {
  if (status === 'active') return 'bg-green-500';
  if (status === 'error') return 'bg-red-500';
  return 'bg-gray-400';
}

// ─── Create Instance Dialog ──────────────────────────────────────────

function CreateInstanceDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('whatsapp');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('env');

  const mutation = useMutation({
    mutationFn: () => createInstance({ type, label, source }),
    onSuccess: () => {
      setOpen(false);
      setLabel('');
      onCreated();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusIcon className="h-3.5 w-3.5" />
          Add Channel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Channel Instance</DialogTitle>
          <DialogDescription>
            Create a new channel instance for messaging.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Channel Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="voice">Voice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Main WhatsApp +65 1234"
            />
          </div>
          <div className="space-y-2">
            <Label>Credential Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="env">Environment</SelectItem>
                <SelectItem value="self">Self-managed</SelectItem>
                <SelectItem value="platform">Platform</SelectItem>
                <SelectItem value="sandbox">Sandbox</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!label.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
        {mutation.isError && (
          <p className="text-xs text-destructive">{mutation.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Channel Routing Dialog ───────────────────────────────────

function CreateChannelRoutingDialog({
  instances,
  agents,
  onCreated,
}: {
  instances: ChannelInstance[];
  agents: Agent[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [pattern, setPattern] = useState('direct');

  const mutation = useMutation({
    mutationFn: () =>
      createChannelRouting({
        name,
        channelInstanceId: instanceId,
        agentId,
        assignmentPattern: pattern,
      }),
    onSuccess: () => {
      setOpen(false);
      setName('');
      setInstanceId('');
      setAgentId('');
      onCreated();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <PlusIcon className="h-3.5 w-3.5" />
          Add Channel Routing
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Channel Routing</DialogTitle>
          <DialogDescription>
            Connect a channel to an AI agent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Booking Agent — WhatsApp"
            />
          </div>
          <div className="space-y-2">
            <Label>Channel Instance</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select channel..." />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.label} ({inst.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>AI Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select AI agent..." />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Assignment Pattern</Label>
            <Select value={pattern} onValueChange={setPattern}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="router">Router</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              !name.trim() || !instanceId || !agentId || mutation.isPending
            }
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
        {mutation.isError && (
          <p className="text-xs text-destructive">{mutation.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function ChannelsPage() {
  const queryClient = useQueryClient();

  const {
    data: instances = [],
    isLoading: instancesLoading,
    isError: instancesError,
  } = useQuery({
    queryKey: ['channel-instances'],
    queryFn: fetchInstances,
  });

  const { data: channelRoutings = [], isLoading: channelRoutingsLoading } =
    useQuery({
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

  const sessionCountMap = new Map(
    (channelStatusData?.channels ?? []).map((ch) => [
      ch.id,
      ch.activeSessionCount,
    ]),
  );

  const deleteMutation = useMutation({
    mutationFn: deleteInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-instances'] });
      queryClient.invalidateQueries({ queryKey: ['channel-routings'] });
    },
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['channel-instances'] });
    queryClient.invalidateQueries({ queryKey: ['channel-routings'] });
  }

  // Group instances by type
  const grouped = instances.reduce<Record<string, ChannelInstance[]>>(
    (acc, inst) => {
      const list = acc[inst.type] ?? [];
      list.push(inst);
      acc[inst.type] = list;
      return acc;
    },
    {},
  );

  const agentMap = new Map(agents.map((a) => [a.id, a.name]));
  const instanceMap = new Map(instances.map((i) => [i.id, i]));
  const endpointCount = (id: string) =>
    channelRoutings.filter((cr) => cr.channelInstanceId === id).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Channels</h2>
          <p className="text-sm text-muted-foreground">
            Configure messaging channels and endpoints
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateChannelRoutingDialog
            instances={instances}
            agents={agents}
            onCreated={invalidateAll}
          />
          <CreateInstanceDialog onCreated={invalidateAll} />
        </div>
      </div>

      {/* Channel Instances */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Channel Instances
        </h2>

        {instancesLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        )}

        {instancesError && (
          <p className="text-sm text-destructive">
            Failed to load channel instances.
          </p>
        )}

        {!instancesLoading && instances.length === 0 && (
          <div className="rounded-lg border bg-muted/20 py-8 text-center">
            <CableIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              No channel instances configured.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a channel to start receiving messages.
            </p>
          </div>
        )}

        {Object.entries(grouped).map(([type, list]) => {
          const Icon = channelIcon(type);

          return (
            <div key={type} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium capitalize">{type}</h3>
                <Badge variant="secondary" className="text-[10px]">
                  {list.length}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((inst) => (
                  <Card key={inst.id} size="sm">
                    <CardContent>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div
                              className={`h-2 w-2 rounded-full ${statusDot(inst.status)}`}
                            />
                            <p className="text-sm font-medium truncate">
                              {inst.label}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant={sourceVariant(inst.source)}
                              className="text-[10px]"
                            >
                              {inst.source}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {endpointCount(inst.id)} routing
                              {endpointCount(inst.id) !== 1 ? 's' : ''}
                            </span>
                            {(sessionCountMap.get(inst.id) ?? 0) > 0 && (
                              <span className="text-[10px] font-medium text-foreground">
                                {sessionCountMap.get(inst.id)} active
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(inst.id)}
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Channel Routings */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Channel Routings
        </h2>

        {channelRoutingsLoading && <Skeleton className="h-32 w-full" />}

        {!channelRoutingsLoading && channelRoutings.length === 0 && (
          <div className="rounded-lg border bg-muted/20 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No channel routings configured. Create one to connect a channel to
              an AI agent.
            </p>
          </div>
        )}

        {channelRoutings.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Channel
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    AI Agent
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Pattern
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Link
                  </th>
                </tr>
              </thead>
              <tbody>
                {channelRoutings.map((cr) => {
                  const inst = instanceMap.get(cr.channelInstanceId);
                  return (
                    <tr
                      key={cr.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium">{cr.name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {inst
                          ? `${inst.label} (${inst.type})`
                          : cr.channelInstanceId}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {agentMap.get(cr.agentId) ?? cr.agentId}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className="text-[10px] capitalize"
                        >
                          {cr.assignmentPattern}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={cr.enabled ? 'success' : 'secondary'}
                          className="text-[10px]"
                        >
                          {cr.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {inst?.type === 'web' && (
                          <a
                            href={`/chat/${cr.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLinkIcon className="h-3 w-3" />
                            Open
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/channels/')({
  component: ChannelsPage,
});
