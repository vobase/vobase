import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouter } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { Sidebar } from '@/shell/sidebar';

function AppLayout() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.invalidate();
  }

  return (
    <div className="grid h-screen grid-cols-1 bg-background lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:block sticky top-0 h-screen overflow-y-auto" />

      <div className="flex h-screen flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              Vobase
            </p>
          </div>
          {isPending ? (
            <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          ) : session?.user ? (
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
              <Button variant="outline" size="sm" asChild>
                <Link to="/login">Log in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/signup">Sign up</Link>
              </Button>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data?.session) {
      throw redirect({ to: '/login' });
    }
  },
  component: AppLayout,
});
