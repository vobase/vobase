import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  Loader2Icon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  SendIcon,
  UnplugIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { integrationsClient } from '@/lib/api-client';
import { runWhatsAppEmbeddedSignup } from '@/lib/facebook-sdk';

// ─── Types ─────────────────────────────────────────────────────────────

type InstanceSource = 'env' | 'self' | 'platform' | 'sandbox';
type InstanceStatus = 'active' | 'disconnected' | 'error';

interface ChannelInstance {
  id: string;
  type: string;
  integrationId: string | null;
  label: string | null;
  source: InstanceSource;
  config: Record<string, unknown>;
  status: InstanceStatus;
  createdAt: string;
}

// ─── Constants ─────────────────────────────────────────────────────────

const CHANNEL_PROVIDERS = [
  {
    type: 'whatsapp',
    label: 'WhatsApp Business',
    icon: MessageSquareIcon,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-500/10',
  },
  {
    type: 'telegram',
    label: 'Telegram',
    icon: SendIcon,
    iconColor: 'text-sky-600 dark:text-sky-400',
    iconBg: 'bg-sky-500/10',
  },
  {
    type: 'messenger',
    label: 'Messenger',
    icon: MessageSquareIcon,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-500/10',
  },
  {
    type: 'instagram',
    label: 'Instagram',
    icon: MessageSquareIcon,
    iconColor: 'text-pink-600 dark:text-pink-400',
    iconBg: 'bg-pink-500/10',
  },
  {
    type: 'email',
    label: 'Email',
    icon: MailIcon,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-500/10',
  },
  {
    type: 'voice',
    label: 'Voice',
    icon: PhoneIcon,
    iconColor: 'text-orange-600 dark:text-orange-400',
    iconBg: 'bg-orange-500/10',
  },
] as const;

const SERVICE_PROVIDERS = [
  {
    type: 'google',
    label: 'Google',
    icon: MessageSquareIcon,
    iconColor: 'text-red-600 dark:text-red-400',
    iconBg: 'bg-red-500/10',
  },
  {
    type: 'xero',
    label: 'Xero',
    icon: MessageSquareIcon,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-500/10',
  },
] as const;

// ─── Helpers ───────────────────────────────────────────────────────────

function sourceBadge(source: InstanceSource) {
  switch (source) {
    case 'env':
      return <Badge variant="secondary">Environment</Badge>;
    case 'platform':
      return (
        <Badge
          variant="default"
          className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20"
        >
          Platform
        </Badge>
      );
    case 'sandbox':
      return (
        <Badge
          variant="default"
          className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20"
        >
          Sandbox
        </Badge>
      );
    case 'self':
      return (
        <Badge
          variant="default"
          className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
        >
          Connected
        </Badge>
      );
  }
}

function statusBadge(status: InstanceStatus) {
  switch (status) {
    case 'active':
      return <Badge variant="success">Active</Badge>;
    case 'disconnected':
      return <Badge variant="secondary">Disconnected</Badge>;
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
  }
}

// ─── Instance Row ──────────────────────────────────────────────────────

function InstanceRow({
  instance,
  onDisconnect,
  disconnecting,
}: {
  instance: ChannelInstance;
  onDisconnect: (id: string) => void;
  disconnecting: boolean;
}) {
  const canDisconnect =
    instance.source === 'self' ||
    instance.source === 'sandbox' ||
    instance.source === 'platform';
  const label = instance.label ?? instance.id;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <span className="flex-1 truncate text-xs font-medium">{label}</span>
      <div className="flex items-center gap-1.5">
        {sourceBadge(instance.source)}
        {statusBadge(instance.status)}
      </div>
      {canDisconnect && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => onDisconnect(instance.id)}
          disabled={disconnecting}
        >
          {disconnecting ? (
            <Loader2Icon className="h-3 w-3 animate-spin" />
          ) : (
            <UnplugIcon className="h-3 w-3" />
          )}
        </Button>
      )}
    </div>
  );
}

// ─── Provider Row ──────────────────────────────────────────────────────

function ProviderRow({
  providerType,
  label,
  icon: Icon,
  iconColor,
  iconBg,
  instances,
  onConnect,
  onDisconnect,
  disconnectingId,
  connectDisabled,
}: {
  providerType: string;
  label: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  instances: ChannelInstance[];
  onConnect: (type: string) => void;
  onDisconnect: (id: string) => void;
  disconnectingId: string | null;
  connectDisabled?: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-md ${iconBg}`}
          >
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <CardTitle className="flex-1 text-sm">{label}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onConnect(providerType)}
            disabled={connectDisabled}
          >
            Connect
          </Button>
        </div>
      </CardHeader>
      {instances.length > 0 && (
        <CardContent>
          <div className="flex flex-col gap-1.5">
            {instances.map((inst) => (
              <InstanceRow
                key={inst.id}
                instance={inst}
                onDisconnect={onDisconnect}
                disconnecting={disconnectingId === inst.id}
              />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ['integrations-config'],
    queryFn: async () => {
      const res = await integrationsClient.config.$get();
      return res.json();
    },
  });

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['integrations-instances'],
    queryFn: async (): Promise<ChannelInstance[]> => {
      const res = await integrationsClient.instances.$get();
      return res.json() as Promise<ChannelInstance[]>;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await integrationsClient.instances[':id'].disconnect.$post({
        param: { id },
      });
      return res.json();
    },
    onSettled: () => {
      setDisconnectingId(null);
      queryClient.invalidateQueries({ queryKey: ['integrations-instances'] });
    },
  });

  const instancesByType = instances.reduce<Record<string, ChannelInstance[]>>(
    (acc, inst) => {
      if (!acc[inst.type]) acc[inst.type] = [];
      acc[inst.type].push(inst);
      return acc;
    },
    {},
  );

  const handleConnect = async (type: string) => {
    const platformUrl = import.meta.env.VITE_PLATFORM_URL;
    const metaChannels = ['whatsapp', 'messenger', 'instagram'];

    // Platform-managed: redirect to platform OAuth proxy for Meta Embedded Signup
    if (metaChannels.includes(type) && !config?.metaAppId && platformUrl) {
      const slug =
        import.meta.env.VITE_PLATFORM_TENANT_SLUG ||
        window.location.hostname.split('.')[0];
      window.location.href = `${platformUrl}/api/oauth-proxy/${type}/connect?tenant=${slug}`;
      return;
    }

    if (type !== 'whatsapp') return; // other types: stub / future

    if (!config?.metaAppId || !config?.metaConfigId) {
      setConnectError(
        'META_APP_ID and META_CONFIG_ID must be set in your environment before connecting WhatsApp.',
      );
      return;
    }

    setConnectingType(type);
    setConnectError(null);

    try {
      const { code, wabaId, phoneNumberId } = await runWhatsAppEmbeddedSignup(
        config.metaAppId,
        config.metaConfigId,
      );

      const res = await integrationsClient.whatsapp.connect.$post({
        json: { code, wabaId, phoneNumberId },
      });
      const result = await res.json();
      if ('error' in result && result.error) {
        setConnectError(result.error as string);
      }
      queryClient.invalidateQueries({ queryKey: ['integrations-instances'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      if (msg !== 'cancelled') setConnectError(msg);
      queryClient.invalidateQueries({ queryKey: ['integrations-instances'] });
    } finally {
      setConnectingType(null);
    }
  };

  const handleDisconnect = (id: string) => {
    setDisconnectingId(id);
    disconnectMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading integrations...
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage channel connections and external service credentials.
        </p>
      </div>

      {connectError && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {connectError}
        </div>
      )}

      {/* ─── Channels ───────────────────────────────────────────────── */}
      <section className="mb-6">
        <p className="mb-2 px-1 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Channels
        </p>
        <div className="flex flex-col gap-2">
          {CHANNEL_PROVIDERS.map(({ type, label, icon, iconColor, iconBg }) => (
            <ProviderRow
              key={type}
              providerType={type}
              label={label}
              icon={icon}
              iconColor={iconColor}
              iconBg={iconBg}
              instances={instancesByType[type] ?? []}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              disconnectingId={disconnectingId}
              connectDisabled={connectingType === type}
            />
          ))}
        </div>
      </section>

      {/* ─── Services ───────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 px-1 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Services
        </p>
        <div className="flex flex-col gap-2">
          {SERVICE_PROVIDERS.map(({ type, label, icon, iconColor, iconBg }) => (
            <ProviderRow
              key={type}
              providerType={type}
              label={label}
              icon={icon}
              iconColor={iconColor}
              iconBg={iconBg}
              instances={instancesByType[type] ?? []}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              disconnectingId={disconnectingId}
              connectDisabled
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/integrations')({
  component: IntegrationsPage,
});
