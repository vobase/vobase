import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { authClient } from '../../lib/auth-client';

export type SignupPageProps = Record<string, never>;

export function SignupPage(_: Readonly<SignupPageProps>) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const result = await authClient.signUp.email({
      name,
      email,
      password,
    });

    if (result.error) {
      setMessage(result.error.message ?? 'Unable to create account.');
      setIsSubmitting(false);
      return;
    }

    setMessage('Account created. You can now log in.');
    setIsSubmitting(false);
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center p-6">
      <Card className="w-full max-w-md border-border/70 bg-card/90">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>
            Start your vobase workspace in minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="signup-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="signup-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="signup-password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="signup-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            {message ? (
              <p className="text-sm text-muted-foreground">{message}</p>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/signup')({
  component: SignupPage,
});
