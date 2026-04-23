import { Link } from '@tanstack/react-router'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export default function NotFoundPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <FileQuestion className="size-6" />
        </EmptyMedia>
        <EmptyTitle>404</EmptyTitle>
        <EmptyDescription>Page not found.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to="/messaging">Back to Messaging</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
