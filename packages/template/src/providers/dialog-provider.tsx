import { PhoneVerifyDialog } from '@modules/team/components/phone-verify-dialog'
import { createContext, useCallback, useContext, useState } from 'react'

interface DialogContextValue {
  /** Open the standalone WhatsApp-number verification dialog for the signed-in user. */
  openPhoneVerify: () => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

/**
 * Hosts app-global dialogs that can be triggered from anywhere (e.g. a toast
 * action outside the router, or a Team-list row). Mirrors `SearchProvider`.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [phoneVerifyOpen, setPhoneVerifyOpen] = useState(false)
  const openPhoneVerify = useCallback(() => setPhoneVerifyOpen(true), [])

  return (
    <DialogContext.Provider value={{ openPhoneVerify }}>
      {children}
      <PhoneVerifyDialog open={phoneVerifyOpen} onOpenChange={setPhoneVerifyOpen} />
    </DialogContext.Provider>
  )
}

export function useDialogs(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    throw new Error('useDialogs must be used within a DialogProvider')
  }
  return ctx
}
