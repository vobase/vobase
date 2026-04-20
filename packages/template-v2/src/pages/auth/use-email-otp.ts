import { useMutation } from '@tanstack/react-query'
import { authClient } from '@/lib/auth-client'

export async function sendOtpFn({ email }: { email: string }) {
  return authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
}

export async function verifyOtpFn({ email, otp }: { email: string; otp: string }) {
  return authClient.signIn.emailOtp({ email, otp })
}

export function useEmailOtp() {
  const sendOtp = useMutation({ mutationFn: sendOtpFn })
  const verifyOtp = useMutation({ mutationFn: verifyOtpFn })
  return { sendOtp, verifyOtp }
}
