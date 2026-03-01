import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';

export interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: Readonly<LayoutProps>) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:block" />

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/75 px-4 backdrop-blur md:px-6">
          <div>
            <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Vobase Shell</p>
            <p className="text-sm font-semibold">TanStack Router + Hono RPC</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
            >
              Log in
            </Link>
            <Link to="/signup" className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              Sign up
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
