import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

interface Props {
  error?: Error
  reset?: () => void
}

export default function GeneralErrorPage({ error, reset }: Props) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <TriangleAlert className="size-6" />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>{error?.message ?? 'An unexpected error occurred.'}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={reset ?? (() => window.location.reload())}>Try again</Button>
      </EmptyContent>
    </Empty>
  )
}
