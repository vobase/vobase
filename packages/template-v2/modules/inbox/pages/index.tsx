import { createFileRoute } from '@tanstack/react-router'
import { Inbox as InboxIcon } from 'lucide-react'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export function InboxEmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty>
        <EmptyMedia>
          <InboxIcon className="size-5" />
        </EmptyMedia>
        <EmptyTitle>No conversation selected</EmptyTitle>
        <EmptyDescription>Select a conversation from the list to get started.</EmptyDescription>
      </Empty>
    </div>
  )
}

export const Route = createFileRoute('/_app/inbox/')({
  component: InboxEmptyState,
})
