import { KeyIcon } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '@/components/empty-state'

export function ApiKeysPage() {
  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">API Keys</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage programmatic access to your workspace.
        </p>
      </div>

      <EmptyState
        icon={KeyIcon}
        title="No API keys yet"
        description="API keys allow programmatic access to your workspace. Management coming soon."
        action={{
          label: 'Create API Key',
          onClick: () => {
            // coming soon
          },
        }}
      />
    </div>
  )
}

export const Route = createFileRoute('/_app/settings/api-keys')({
  component: ApiKeysPage,
})
