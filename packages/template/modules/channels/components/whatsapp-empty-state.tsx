import { MessageCircle } from 'lucide-react'

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { WhatsAppSignupButton } from './whatsapp-signup-button'

interface WhatsAppEmptyStateProps {
  onConnected: (instanceId: string) => void
  onAddWebChannel: () => void
}

export function WhatsAppEmptyState({ onConnected, onAddWebChannel }: WhatsAppEmptyStateProps) {
  return (
    <Empty className="border border-dashed py-16">
      <EmptyHeader>
        <EmptyMedia>
          <MessageCircle className="size-8 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No channels yet</EmptyTitle>
        <EmptyDescription>
          Connect WhatsApp to start receiving and sending messages from a single inbox.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <WhatsAppSignupButton onConnected={onConnected} variant="hero" />
        <p className="mt-4 text-center text-muted-foreground text-xs">
          Or{' '}
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground"
            onClick={onAddWebChannel}
          >
            add a web chat widget
          </button>{' '}
          instead.
        </p>
        <p className="mt-1 text-center text-muted-foreground text-xs">
          Platform sandbox numbers appear here automatically for new tenants.
        </p>
      </EmptyContent>
    </Empty>
  )
}
