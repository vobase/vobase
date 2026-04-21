import { createFileRoute } from '@tanstack/react-router'
import { HardDrive } from 'lucide-react'
import { DriveBrowser } from '../components/drive-browser'
import { DriveProvider } from '../components/drive-provider'

export function DrivePage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <HardDrive className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Drive</h1>
            <p className="text-sm text-muted-foreground">
              Organization-scope files — brand, policy, and pricing docs. Contact-scope files live on each contact.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <DriveProvider scope={{ scope: 'organization' }} rootLabel="Organization drive">
          <DriveBrowser />
        </DriveProvider>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/drive/')({
  component: DrivePage,
})
