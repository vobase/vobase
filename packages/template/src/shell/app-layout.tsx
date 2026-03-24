import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useState } from 'react';

import { useEscalationNotifications } from '@/hooks/use-notifications';
import { useRealtimeInvalidation } from '@/hooks/use-realtime';
import { authClient } from '@/lib/auth-client';
import { MobileNav } from '@/shell/mobile-nav';
import { ShellHeader } from '@/shell/shell-header';
import { ShellSidebar } from '@/shell/shell-sidebar';

function AppLayout() {
  useRealtimeInvalidation();
  const { unreadCount: escalationCount } = useEscalationNotifications();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <ShellSidebar
        className="hidden lg:flex sticky top-0 h-screen"
        escalationCount={escalationCount}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <ShellHeader onMobileMenuOpen={() => setMobileNavOpen(true)} />

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile navigation drawer */}
      <MobileNav
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        escalationCount={escalationCount}
      />
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
