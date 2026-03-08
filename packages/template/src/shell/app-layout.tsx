import { createFileRoute, Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { Sidebar } from '@/shell/sidebar';

function AppLayout() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && !session?.user) {
      navigate({ to: '/login' });
    }
  }, [isPending, session, navigate]);

  async function handleSignOut() {
    await authClient.signOut();
    router.invalidate();
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:block" />

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              Vobase
            </p>
          </div>
          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {session.user.name || session.user.email}
              </span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" render={<Link to="/login" />} nativeButton={false}>
                Log in
              </Button>
              <Button size="sm" render={<Link to="/signup" />} nativeButton={false}>
                Sign up
              </Button>
            </div>
          )}
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});
