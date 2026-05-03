import { InfoCard } from '@/components/info'
import { DriveBrowser } from './drive-browser'
import { DriveProvider, type DriveProviderProps } from './drive-provider'

type DriveSectionProps = Omit<DriveProviderProps, 'children'>

export function DriveSection({ scope, rootLabel, initialPath, renderPreview }: DriveSectionProps) {
  return (
    <InfoCard className="h-[60vh] min-h-[420px]">
      <DriveProvider scope={scope} rootLabel={rootLabel} initialPath={initialPath} renderPreview={renderPreview}>
        <DriveBrowser />
      </DriveProvider>
    </InfoCard>
  )
}
