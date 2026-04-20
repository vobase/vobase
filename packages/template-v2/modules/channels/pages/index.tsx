import { useQueries } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Globe, MessageCircle, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ChannelHealth {
  module: string
  status: string
}

interface ChannelDef {
  id: string
  name: string
  description: string
  endpoint: string
  icon: React.ElementType
  configHint: string
}

const CHANNELS: ChannelDef[] = [
  {
    id: 'web',
    name: 'Web',
    description: 'In-browser chat widget. Powers /test-web and any embeddable client.',
    endpoint: '/api/channel-web/health',
    icon: Globe,
    configHint: 'Enabled by default in dev. No credentials required.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Meta Cloud API adapter. Inbound webhooks + outbound sender.',
    endpoint: '/api/channel-whatsapp/health',
    icon: MessageCircle,
    configHint: 'Requires META_WA_TOKEN, META_WA_VERIFY_TOKEN, META_WA_PHONE_NUMBER_ID.',
  },
]

async function fetchHealth(endpoint: string): Promise<ChannelHealth | null> {
  try {
    const r = await fetch(endpoint)
    if (!r.ok) return null
    return (await r.json()) as ChannelHealth
  } catch {
    return null
  }
}

export function ChannelsPage() {
  const results = useQueries({
    queries: CHANNELS.map((c) => ({
      queryKey: ['channel-health', c.id],
      queryFn: () => fetchHealth(c.endpoint),
      staleTime: 30_000,
    })),
  })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Channels</h1>
        <p className="text-sm text-muted-foreground">
          Transport adapters connecting customers to this organization's inbox.
        </p>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((ch, i) => {
            const Icon = ch.icon
            const q = results[i]
            const connected = q?.data?.status === 'ok'
            const loading = q?.isLoading
            return (
              <Card key={ch.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                        <Icon className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{ch.name}</CardTitle>
                        <CardDescription className="text-xs">{ch.endpoint}</CardDescription>
                      </div>
                    </div>
                    {loading ? (
                      <Badge variant="secondary">…</Badge>
                    ) : connected ? (
                      <Badge className="bg-success/15 text-success">
                        <Check className="mr-1 size-3" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        <X className="mr-1 size-3" />
                        Offline
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-4">
                  <p className="text-sm text-muted-foreground">{ch.description}</p>
                  <p className="text-xs text-muted-foreground">{ch.configHint}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/channels/')({
  component: ChannelsPage,
})
