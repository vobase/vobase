import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'

function PendingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(false)

  async function handleCheckAgain() {
    setChecking(true)
    try {
      const orgs = await authClient.organization.list()
      if (orgs.data?.[0]) {
        await authClient.organization.setActive({
          organizationId: orgs.data[0].id,
        })
        await router.invalidate()
        router.navigate({ to: '/' })
      } else {
        toast.info('Still no organization. Please contact your administrator.')
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <h1 className="text-xl font-semibold tracking-tight">Access pending</h1>
        <p className="text-sm text-muted-foreground">
          Your account is not part of any organization yet. Ask your administrator to send you an invitation.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button variant="outline" className="w-full" disabled={checking} onClick={handleCheckAgain}>
          {checking ? 'Checking...' : 'Check again'}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={async () => {
            await authClient.signOut()
            router.navigate({ to: '/login' })
          }}
        >
          Sign out
        </Button>
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute('/_auth/pending')({
  component: PendingPage,
})
