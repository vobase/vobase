import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { authClient } from '@/lib/auth-client'
import { SKIP_VERIFY_KEY } from '@/shell/app-layout'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function handleConfirm() {
    try {
      await authClient.signOut({ fetchOptions: { credentials: 'include' } })
    } catch {
      // Ignore transport failures — we still want to clear local state + redirect.
    }
    queryClient.clear()
    try {
      window.sessionStorage?.removeItem(SKIP_VERIFY_KEY)
    } catch {
      // sessionStorage unavailable (private-mode); nothing to clear.
    }
    navigate({ to: '/auth/login', replace: true })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>You will be returned to the login screen.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Sign out</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
