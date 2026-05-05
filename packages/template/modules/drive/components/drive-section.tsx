import { InfoCard } from '@/components/info'
import { cn } from '@/lib/utils'
import { DriveBrowser, type DriveBrowserOrientation } from './drive-browser'
import { DriveProvider, type DriveProviderProps } from './drive-provider'

type DriveSectionProps = Omit<DriveProviderProps, 'children'> & {
  /** Pass-through to DriveBrowser. `vertical` stacks file-list above preview. */
  orientation?: DriveBrowserOrientation
  className?: string
}

export function DriveSection({
  scope,
  rootLabel,
  initialPath,
  renderPreview,
  orientation,
  className,
}: DriveSectionProps) {
  return (
    <InfoCard className={cn('h-[60vh] min-h-[420px]', className)}>
      <DriveProvider scope={scope} rootLabel={rootLabel} initialPath={initialPath} renderPreview={renderPreview}>
        <DriveBrowser orientation={orientation} />
      </DriveProvider>
    </InfoCard>
  )
}
