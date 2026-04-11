import {
  createFileRoute,
  useNavigate,
  useRouter,
  useSearch,
} from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Separator } from '@/components/ui/separator';
import { authClient } from '@/lib/auth-client';

const emailSchema = z.string().email('Please enter a valid email address');

const platformUrl = import.meta.env.VITE_PLATFORM_URL;
const tenantSlug = import.meta.env.VITE_PLATFORM_TENANT_SLUG;

const loginSearchSchema = z.object({
  invitationId: z.string().optional(),
});

function LoginPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const { invitationId } = useSearch({ from: '/_auth/login' });

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      toast.error(result.error.issues[0].message);
      return;
    }

    setLoading(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? 'Failed to send code.');
      return;
    }

    setStep('otp');
    toast.success('Check your email for a verification code.');
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) {
      toast.error('Please enter the 6-digit code.');
      return;
    }

    setLoading(true);
    const { error } = await authClient.signIn.emailOtp({ email, otp });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? 'Invalid or expired code.');
      return;
    }

    // Server-side hook auto-accepts pending invitations on sign-in.
    // Client-side fallback for edge cases (existing user, invitation not yet matched).
    if (invitationId) {
      await authClient.organization
        .acceptInvitation({ invitationId })
        .catch(() => {});
    }

    await router.invalidate();
    navigate({ to: '/' });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          {invitationId
            ? 'Sign in to accept your invitation.'
            : step === 'otp'
              ? `Enter the 6-digit code sent to ${email}.`
              : 'Sign in to your account to continue.'}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {platformUrl && tenantSlug && (
          <>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = `${platformUrl}/api/oauth-proxy/oauth/google/initiate?tenant=${tenantSlug}`;
              }}
            >
              <svg
                className="mr-2 size-4"
                viewBox="0 0 24 24"
                role="img"
                aria-label="Google"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = `${platformUrl}/api/oauth-proxy/oauth/microsoft/initiate?tenant=${tenantSlug}`;
              }}
            >
              <svg
                className="mr-2 size-4"
                viewBox="0 0 21 21"
                role="img"
                aria-label="Microsoft"
              >
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
              Sign in with Microsoft
            </Button>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>
          </>
        )}
        {step === 'email' ? (
          <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
            <Input
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Continue'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp} autoFocus>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Verifying...' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep('email');
                setOtp('');
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
        {import.meta.env.DEV && (
          <>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">dev only</span>
              <Separator className="flex-1" />
            </div>
            <Button
              variant="outline"
              className="w-full border-2 border-dashed border-yellow-500 bg-[repeating-linear-gradient(-45deg,transparent,transparent_8px,rgba(234,179,8,0.08)_8px,rgba(234,179,8,0.08)_16px)] text-yellow-600 hover:border-yellow-400 hover:bg-yellow-500/10 hover:text-yellow-500 dark:border-yellow-600 dark:text-yellow-500 dark:hover:border-yellow-500"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                const res = await fetch('/api/auth/dev-login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: 'admin@example.com' }),
                });
                setLoading(false);
                if (!res.ok) {
                  toast.error('Dev login failed.');
                  return;
                }
                await router.invalidate();
                navigate({ to: '/' });
              }}
            >
              Sign in as Admin (dev)
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
  validateSearch: loginSearchSchema,
});
