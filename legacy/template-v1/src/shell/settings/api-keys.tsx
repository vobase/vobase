import { createFileRoute } from '@tanstack/react-router'
import { KeyIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

function ApiKeysPage() {
  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">API Keys</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Manage programmatic access to your workspace.</p>
      </div>

      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyIcon />
          </EmptyMedia>
          <EmptyTitle>No API keys yet</EmptyTitle>
          <EmptyDescription>
            API keys allow programmatic access to your workspace. Management coming soon.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // coming soon
            }}
          >
            Create API Key
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

export const Route = createFileRoute('/_app/settings/api-keys')({
  component: ApiKeysPage,
})
