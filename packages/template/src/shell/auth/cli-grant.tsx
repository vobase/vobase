import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

type Status = 'idle' | 'confirming' | 'success' | 'error'

interface SessionUser {
  id?: string
  email?: string
  name?: string | null
}

export function CliGrantPage() {
  const navigate = useNavigate()
  const search = useRouterState({ select: (s) => s.location.search })
  const code = new URLSearchParams(search).get('code') ?? ''

  const sessionRes = authClient.useSession() as unknown as {
    data?: { user?: SessionUser | null } | null
    isPending?: boolean
  } | null
  const sessionPending = sessionRes?.isPending ?? false
  const user = sessionRes?.data?.user ?? null

  const [name, setName] = useState('CLI')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setStatus('confirming')
    setError(null)
    try {
      // biome-ignore lint/plugin/no-raw-fetch: cli-grant routes live outside the typed RPC tree
      const res = await fetch('/api/auth/cli-grant/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: name.trim() || 'CLI' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `confirm failed (${res.status})`)
      }
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to confirm.')
    }
  }

  if (!code) {
    return (
      <div className="w-full max-w-sm space-y-2 px-4">
        <h1 className="font-semibold text-xl tracking-tight">CLI authorization</h1>
        <p className="text-destructive text-sm">
          Missing or invalid grant code. Re-run <code className="font-mono text-xs">vobase auth login</code> to start
          over.
        </p>
      </div>
    )
  }

  if (sessionPending) {
    return <div className="w-full max-w-sm px-4 text-muted-foreground text-sm">Checking session…</div>
  }

  if (!user) {
    return (
      <div className="w-full max-w-sm space-y-4 px-4">
        <div className="space-y-1">
          <h1 className="font-semibold text-xl tracking-tight">Sign in to authorize CLI</h1>
          <p className="text-muted-foreground text-sm">
            A terminal session is waiting for approval. Sign in first, then return to this page to authorize the CLI.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link to="/auth/login">Sign in</Link>
        </Button>
        <p className="text-muted-foreground text-xs">
          After signing in, re-open the CLI URL from your terminal (this page).
        </p>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="w-full max-w-sm space-y-3 px-4">
        <h1 className="font-semibold text-xl tracking-tight">CLI authorized</h1>
        <p className="text-muted-foreground text-sm">
          Return to your terminal — the CLI will pick up the new API key automatically. You can close this tab.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="space-y-1">
        <h1 className="font-semibold text-xl tracking-tight">Authorize CLI</h1>
        <p className="text-muted-foreground text-sm">
          Mint an API key bound to <span className="font-medium text-foreground">{user.email ?? 'this account'}</span>{' '}
          for the CLI session waiting in your terminal.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cli-grant-name">Key label</Label>
        <Input
          id="cli-grant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="CLI"
          autoFocus
          maxLength={120}
        />
        <p className="text-muted-foreground text-xs">Shown in the API-keys list. Default: "CLI".</p>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={status === 'confirming'} onClick={confirm}>
          {status === 'confirming' ? 'Authorizing…' : 'Authorize'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={status === 'confirming'}
          onClick={() => navigate({ to: '/inbox' })}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_auth/auth/cli-grant')({
  component: CliGrantPage,
})
