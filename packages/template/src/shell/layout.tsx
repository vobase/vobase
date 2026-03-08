import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Sidebar } from '@/shell/sidebar';

export interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: Readonly<LayoutProps>) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-[260px_1fr]">
      <Sidebar className="hidden lg:block" />

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
          <div>
            <p className="text-xs tracking-widest text-muted-foreground uppercase">
              Vobase Shell
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" render={<Link to="/login" />} nativeButton={false}>
              Log in
            </Button>
            <Button size="sm" render={<Link to="/signup" />} nativeButton={false}>
              Sign up
            </Button>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
