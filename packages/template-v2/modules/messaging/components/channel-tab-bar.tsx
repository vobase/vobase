import { GlobeIcon, MessageSquareIcon, MicIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const CHANNEL_CONFIG: Record<string, { label: string; Icon: typeof GlobeIcon }> = {
  whatsapp: { label: 'WhatsApp', Icon: MessageSquareIcon },
  web: { label: 'Web Chat', Icon: GlobeIcon },
  voice: { label: 'Voice', Icon: MicIcon },
}

function getChannelConfig(type: string | null | undefined) {
  if (!type) return { label: 'Channel', Icon: GlobeIcon }
  return (
    CHANNEL_CONFIG[type] ?? {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      Icon: GlobeIcon,
    }
  )
}

export interface ChannelTab {
  channelInstanceId: string
  type: string | null
  label: string | null
}

interface ChannelTabBarProps {
  tabs: ChannelTab[]
  selectedChannelInstanceId: string | null
  onSelect: (channelInstanceId: string) => void
}

export function ChannelTabBar({ tabs, selectedChannelInstanceId, onSelect }: ChannelTabBarProps) {
  if (tabs.length === 0) return null

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
      {tabs.map((t) => {
        const cfg = getChannelConfig(t.type)
        const selected = t.channelInstanceId === selectedChannelInstanceId
        return (
          <button
            key={t.channelInstanceId}
            type="button"
            onClick={() => onSelect(t.channelInstanceId)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <cfg.Icon className="size-3.5" />
            {t.label ?? cfg.label}
          </button>
        )
      })}
    </div>
  )
}
