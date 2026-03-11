import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth-client';

const isDev = import.meta.env.DEV;

export function LoginPage() {
	const navigate = useNavigate();
	const [message, setMessage] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [email, setEmail] = useState(isDev ? 'admin@example.com' : '');
	const [password, setPassword] = useState(isDev ? 'Admin@vobase1' : '');

	async function handleGoogleLogin() {
		setIsSubmitting(true);
		setMessage(null);

		const result = await authClient.signIn.social({
			provider: 'google',
			callbackURL: `${window.location.origin}/`,
		});

		if (result.error) {
			setMessage(result.error.message ?? 'Unable to sign in.');
			setIsSubmitting(false);
		}
	}

	async function handleEmailLogin(e: React.FormEvent) {
		e.preventDefault();
		setIsSubmitting(true);
		setMessage(null);

		const result = await authClient.signIn.email({
			email,
			password,
		});

		if (result.error) {
			setMessage(result.error.message ?? 'Unable to sign in.');
			setIsSubmitting(false);
		} else {
			navigate({ to: '/' });
		}
	}

	return (
		<>
			<div className="mb-8">
				<h1 className="text-2xl font-bold tracking-tight">Log in</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{isDev
						? 'Sign in with your dev account or Google.'
						: 'Sign in with your Google account to continue.'}
				</p>
			</div>

			{message ? (
				<p className="mb-4 text-sm text-destructive">{message}</p>
			) : null}

			{isDev ? (
				<>
					<form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
							/>
						</div>
						<Button type="submit" className="w-full" disabled={isSubmitting}>
							{isSubmitting ? <Spinner /> : null}
							{isSubmitting ? 'Signing in...' : 'Sign in'}
						</Button>
					</form>

					<div className="relative my-6">
						<Separator />
						<div className="absolute inset-0 flex items-center justify-center">
							<span className="bg-background px-2 text-xs uppercase text-muted-foreground">or</span>
						</div>
					</div>
				</>
			) : null}

			<Button
				className="w-full"
				variant={isDev ? 'outline' : 'default'}
				disabled={isSubmitting}
				onClick={handleGoogleLogin}
			>
				{isSubmitting ? <Spinner /> : null}
				{isSubmitting ? 'Redirecting...' : 'Sign in with Google'}
			</Button>

			<p className="mt-6 text-center text-sm text-muted-foreground">
				Don&apos;t have an account?{' '}
				<Link to="/signup" className="font-medium text-foreground hover:underline">
					Sign up
				</Link>
			</p>
		</>
	);
}

export const Route = createFileRoute('/_auth/login')({
	component: LoginPage,
});
