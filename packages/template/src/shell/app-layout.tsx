import {
  createFileRoute,
  isRedirect,
  Outlet,
  redirect,
} from '@tanstack/react-router';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useEscalationNotifications } from '@/hooks/use-notifications';
import { useRealtimeInvalidation } from '@/hooks/use-realtime';
import { authClient } from '@/lib/auth-client';
import { SearchProvider } from '@/providers/search-provider';

function AppLayout() {
  useRealtimeInvalidation();
  useEscalationNotifications();
  const defaultOpen =
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('sidebar_state='))
      ?.split('=')[1] !== 'false';

  return (
    <SearchProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </SearchProvider>
  );
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    try {
      const { data, error } = await authClient.getSession();
      if (error) {
        // Network/server errors (e.g. backend restarting) — only allow through
        // if a session cookie exists (user was previously authenticated)
        const hasSessionCookie = document.cookie.includes(
          'better-auth.session_token',
        );
        if (!hasSessionCookie) {
          throw redirect({ to: '/login' });
        }
        console.warn('[auth] Session check failed, using cached session');
        return;
      }
      if (!data?.session) {
        throw redirect({ to: '/login' });
      }
      // Require org membership — users without an org see a pending access page
      if (!data.session.activeOrganizationId) {
        // Check if user belongs to any org and just needs activation
        const orgs = await authClient.organization.list();
        const firstOrg = orgs.data?.[0];
        if (firstOrg) {
          await authClient.organization.setActive({
            organizationId: firstOrg.id,
          });
        } else {
          throw redirect({ to: '/pending' });
        }
      }
    } catch (e) {
      if (isRedirect(e)) throw e;
      console.warn('[auth] Session check failed:', e);
    }
  },
  component: AppLayout,
});
