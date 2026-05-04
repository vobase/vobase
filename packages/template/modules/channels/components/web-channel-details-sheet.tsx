import { useQuery } from '@tanstack/react-query'
import { Check, Code2, Copy, ExternalLink, Globe } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { channelsClient } from '@/lib/api-client'
import type { ChannelInstanceRow } from './channels-table'

interface WebInstance {
  id: string
  displayName: string | null
}

function toWebInstance(row: ChannelInstanceRow): WebInstance {
  return { id: row.id, displayName: row.displayName }
}

async function fetchInstance(id: string): Promise<WebInstance> {
  const r = await channelsClient.instances[':id'].$get({ param: { id } })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return toWebInstance((await r.json()) as ChannelInstanceRow)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className="absolute top-2 right-2 h-7 gap-1 text-xs"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function SnippetBlock({ snippet, language }: { snippet: string; language: string }) {
  return (
    <div className="relative">
      <pre
        className="overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-foreground text-xs"
        data-language={language}
      >
        {snippet}
      </pre>
      <CopyButton text={snippet} />
    </div>
  )
}

function ChatLinkField({ instance }: { instance: WebInstance }) {
  const apiOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'
  const chatUrl = `${apiOrigin}/chat/${encodeURIComponent(instance.id)}`
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(chatUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">Direct chat link</Label>
      <div className="flex items-center gap-1.5">
        <Input
          readOnly
          value={chatUrl}
          className="flex-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy link'}
          title={copied ? 'Copied' : 'Copy link'}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => window.open(chatUrl, '_blank', 'noopener,noreferrer')}
          aria-label="Open in new tab"
          title="Open in new tab"
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function EmbedSnippets({ instance }: { instance: WebInstance }) {
  const apiOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'
  const botName = instance.displayName || 'Support'

  const scriptSnippet = [
    '<script async defer',
    `  src="${apiOrigin}/widget.js"`,
    '  data-vobase-widget',
    `  data-channel-instance-id="${instance.id}"`,
    `  data-bot-name="${botName}"`,
    '  data-color="#6b5b4e">',
    '</script>',
  ].join('\n')

  const jsSnippet = [
    '// Inject the Vobase web widget programmatically',
    "const s = document.createElement('script')",
    `s.src = '${apiOrigin}/widget.js'`,
    's.async = true',
    's.defer = true',
    "s.setAttribute('data-vobase-widget', '')",
    `s.setAttribute('data-channel-instance-id', '${instance.id}')`,
    `s.setAttribute('data-bot-name', ${JSON.stringify(botName)})`,
    "s.setAttribute('data-color', '#6b5b4e')",
    'document.body.appendChild(s)',
  ].join('\n')

  return (
    <Tabs defaultValue="script" className="w-full">
      <TabsList>
        <TabsTrigger value="script" className="gap-1.5">
          <Code2 className="size-3.5" />
          Script tag
        </TabsTrigger>
        <TabsTrigger value="js" className="gap-1.5">
          <Code2 className="size-3.5" />
          JavaScript
        </TabsTrigger>
      </TabsList>
      <TabsContent value="script">
        <SnippetBlock snippet={scriptSnippet} language="html" />
        <p className="mt-2 text-muted-foreground text-xs">
          Paste before <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code> on any page.
        </p>
      </TabsContent>
      <TabsContent value="js">
        <SnippetBlock snippet={jsSnippet} language="js" />
        <p className="mt-2 text-muted-foreground text-xs">
          Use this when you inject scripts from your SPA or a tag manager.
        </p>
      </TabsContent>
    </Tabs>
  )
}

function BubblePreview({ instance }: { instance: WebInstance }) {
  const botName = instance.displayName || 'Support'
  const color = '#6b5b4e'

  return (
    <div className="relative h-[360px] w-full overflow-hidden rounded-md border border-border bg-[linear-gradient(135deg,_#f8f7f6,_#eceae8)]">
      <div className="absolute top-4 left-4 text-[10px] text-muted-foreground uppercase tracking-widest">Preview</div>

      {/* Welcome panel */}
      <div className="absolute right-4 bottom-[74px] w-[380px] overflow-hidden rounded-xl bg-white shadow-[0_12px_48px_rgba(0,0,0,0.15),0_4px_16px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-3 border-[#e5e5e5] border-b bg-white px-3 py-3">
          <div
            className="flex size-8 items-center justify-center rounded-full text-white"
            style={{ background: color }}
            aria-hidden
          >
            <Globe className="size-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <div className="flex items-center gap-1.5 font-semibold text-[#1a1a1a] text-[13px]">
              {botName}
              <span className="inline-block size-1.5 rounded-full bg-[#22c55e]" />
            </div>
            <div className="text-[#6b7280] text-[10px]">Typically replies in a few minutes</div>
          </div>
        </div>
        <div className="flex min-h-[160px] flex-col justify-end bg-[linear-gradient(180deg,_#f8f7f6,_#fff)] p-3">
          <div className="rounded-lg border border-[#e5e5e5] bg-white p-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="font-semibold text-[#1a1a1a] text-[14px]">Hi there!</div>
            <div className="mt-0.5 text-[#6b7280] text-[11px]">How can we help?</div>
            <div className="mt-3 flex items-center gap-1.5 text-[#6b7280] text-[10px]">
              <span className="inline-block size-1.5 rounded-full bg-[#22c55e]" />
              We are Online
            </div>
            <div className="mt-3 font-semibold text-[#1a1a1a] text-[11px]">Start Conversation →</div>
          </div>
        </div>
        <div className="py-1.5 text-center text-[#9ca3af] text-[9px]">⚡ Powered by Vobase</div>
      </div>

      {/* Bubble */}
      <div
        className="absolute right-4 bottom-4 flex size-[52px] items-center justify-center rounded-full text-white shadow-[0_4px_16px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.1)]"
        style={{ background: color }}
        aria-hidden
      >
        <Globe className="size-5" />
      </div>
    </div>
  )
}

interface WebChannelDetailsSheetProps {
  open: boolean
  instanceId: string
  onOpenChange: (open: boolean) => void
}

export function WebChannelDetailsSheet({ open, instanceId, onOpenChange }: WebChannelDetailsSheetProps) {
  const { data: instance } = useQuery({
    queryKey: ['channels', 'instances', instanceId],
    queryFn: () => fetchInstance(instanceId),
    enabled: open && !!instanceId,
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{instance?.displayName ?? 'Web channel'}</SheetTitle>
          <SheetDescription>Embed code and widget preview</SheetDescription>
        </SheetHeader>

        {instance && (
          <div className="mt-6 flex flex-col gap-6 px-6 pb-6">
            <ChatLinkField instance={instance} />
            <EmbedSnippets instance={instance} />
            <BubblePreview instance={instance} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
