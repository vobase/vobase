import { createFileRoute } from '@tanstack/react-router'
import { InboxIcon } from 'lucide-react'

function NoContactSelected() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-2">
        <InboxIcon className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Select a contact to view their timeline</p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/messaging/inbox/')({
  component: NoContactSelected,
})
