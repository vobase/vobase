import { zodResolver } from '@hookform/resolvers/zod';
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { authClient } from '@/lib/auth-client';

const isDev = import.meta.env.DEV;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

function LoginPage() {
  const router = useRouter();
  const navigate = useNavigate();

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: isDev ? 'admin@example.com' : '',
      password: isDev ? 'Admin@vobase1' : '',
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function handleGoogleLogin() {
    const platformUrl = import.meta.env.VITE_PLATFORM_URL;
    if (platformUrl) {
      const slug = window.location.hostname.split('.')[0];
      window.location.href = `${platformUrl}/api/oauth-proxy/oauth/google/initiate?tenant=${slug}`;
      return;
    }

    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: `${window.location.origin}/`,
    });

    if (result.error) {
      toast.error(result.error.message ?? 'Unable to sign in.');
    }
  }

  async function onSubmit(values: LoginValues) {
    const result = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });

    if (result.error) {
      toast.error(result.error.message ?? 'Unable to sign in.');
      return;
    }

    await router.invalidate();
    navigate({ to: '/' });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          {isDev
            ? 'Sign in with your dev account or Google.'
            : 'Sign in with your Google account to continue.'}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {isDev ? (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </Form>
        ) : null}

        {!isDev ? (
          <Button
            className="w-full"
            variant="outline"
            disabled={isSubmitting}
            onClick={handleGoogleLogin}
          >
            {isSubmitting ? 'Redirecting...' : 'Sign in with Google'}
          </Button>
        ) : null}
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-xs text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            to="/signup"
            className="font-medium text-foreground hover:underline"
          >
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
});
