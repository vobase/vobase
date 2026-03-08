import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth-client';

export type SignupPageProps = Record<string, never>;

export function SignupPage(_: Readonly<SignupPageProps>) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setIsError(false);

    const result = await authClient.signUp.email({
      name,
      email,
      password,
    });

    if (result.error) {
      setMessage(result.error.message ?? 'Unable to create account.');
      setIsError(true);
      setIsSubmitting(false);
      return;
    }

    setMessage('Account created. You can now log in.');
    setIsSubmitting(false);
  }

  return (
    <div className="flex min-h-[calc(100vh-56px)] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>
            Start your vobase workspace in minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="signup-name">Name</FieldLabel>
                <Input
                  id="signup-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-email">Email</FieldLabel>
                <Input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="signup-password">Password</FieldLabel>
                <Input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
            </FieldGroup>

            {message ? (
              <p className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Spinner /> : null}
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
