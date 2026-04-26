import { createFileRoute, useParams } from '@tanstack/react-router'

import { ViewRenderer } from '@/components/view-renderer'

function ContactsViewPage() {
  const { slug } = useParams({ from: '/_app/contacts/views/$slug' })
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-semibold text-xl">Contacts — {slug}</h1>
        <span className="text-muted-foreground text-xs">scope: object:contacts</span>
      </div>
      <ViewRenderer scope="object:contacts" slug={slug} />
    </div>
  )
}

export const Route = createFileRoute('/_app/contacts/views/$slug')({
  component: ContactsViewPage,
})
