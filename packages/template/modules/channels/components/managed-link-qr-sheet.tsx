import { Check, Copy, ExternalLink, MessageCircle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface ManagedLinkQrSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Local channel_instance id used in the /link command payload. */
  channelInstanceId: string
  /** Platform's shared sandbox WhatsApp number in E.164 (with or without leading +). */
  displayPhoneNumber: string | null
}

/**
 * QR + tap-to-link sheet for the platform-managed sandbox WhatsApp number.
 *
 * Encodes a `wa.me/<phone>?text=/link <tenantSlug> <channelInstanceId>` URL
 * so a tester scans, lands in WhatsApp with the command pre-filled, and
 * sends to the shared sandbox. The platform's `/link` handler reads the
 * payload and creates/replaces the tester_link row binding their phone to
 * this `(tenant, channel_instance)`.
 *
 * Mirror of legacy/template-v1's QrCodeDialog UX.
 */
export function ManagedLinkQrSheet({
  open,
  onOpenChange,
  channelInstanceId,
  displayPhoneNumber,
}: ManagedLinkQrSheetProps) {
  const tenantSlug = (import.meta.env.VITE_PLATFORM_TENANT_SLUG as string | undefined) ?? ''
  const linkText = `/link ${tenantSlug} ${channelInstanceId}`
  const phone = (displayPhoneNumber ?? '').replace(/[^\d]/g, '')
  const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(linkText)}` : null

  const [copiedText, setCopiedText] = useState(false)

  async function copyText() {
    try {
      await navigator.clipboard.writeText(linkText)
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Link a tester</SheetTitle>
          <SheetDescription>
            Scan this QR code from your phone, or tap the button below to open WhatsApp with the link command
            pre-filled. The first message you send registers your number as a tester for this channel.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-6 px-6 pb-6">
          {waUrl ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 p-6">
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={waUrl} size={240} marginSize={2} level="M" />
              </div>
              {displayPhoneNumber && (
                <div className="text-center font-mono text-muted-foreground text-xs">+{phone}</div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              Display phone number not available yet — finish the channel setup first.
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Or send this message manually</Label>
            <div className="flex items-center gap-1.5">
              <Input
                readOnly
                value={linkText}
                className="flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyText}
                aria-label={copiedText ? 'Copied' : 'Copy command'}
                title={copiedText ? 'Copied' : 'Copy command'}
              >
                {copiedText ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {waUrl && (
            <Button asChild className="gap-2">
              <a href={waUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" />
                Open in WhatsApp
                <ExternalLink className="size-3.5 opacity-70" />
              </a>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
