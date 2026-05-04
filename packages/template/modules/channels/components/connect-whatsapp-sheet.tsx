import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { WhatsAppSignupButton } from './whatsapp-signup-button'

interface ConnectWhatsAppSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: (instanceId: string) => void
}

export function ConnectWhatsAppSheet({ open, onOpenChange, onConnected }: ConnectWhatsAppSheetProps) {
  function handleConnected(instanceId: string) {
    onOpenChange(false)
    onConnected(instanceId)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Connect WhatsApp</SheetTitle>
          <SheetDescription>
            Link your WhatsApp Business number to receive and send messages from your inbox.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <WhatsAppSignupButton onConnected={handleConnected} variant="compact" />
        </div>
      </SheetContent>
    </Sheet>
  )
}
