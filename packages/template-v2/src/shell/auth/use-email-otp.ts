import { useMutation } from '@tanstack/react-query'

import { authClient } from '@/lib/auth-client'

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function sendOtpFn({ email }: { email: string }) {
  return authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function verifyOtpFn({ email, otp }: { email: string; otp: string }) {
  return authClient.signIn.emailOtp({ email, otp })
}

export function useEmailOtp() {
  const sendOtp = useMutation({ mutationFn: sendOtpFn })
  const verifyOtp = useMutation({ mutationFn: verifyOtpFn })
  return { sendOtp, verifyOtp }
}
