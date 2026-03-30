import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from '@tanstack/react-router';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { Header } from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useEscalationNotifications } from '@/hooks/use-notifications';
import { useRealtimeInvalidation } from '@/hooks/use-realtime';
import { authClient } from '@/lib/auth-client';
import { isFullHeightRoute } from '@/lib/route-helpers';
import { SearchProvider } from '@/providers/search-provider';

function AppLayout() {
  useRealtimeInvalidation();
  useEscalationNotifications();
  const { pathname } = useLocation();

  const defaultOpen =
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('sidebar_state='))
      ?.split('=')[1] !== 'false';

  const isFullHeight = isFullHeightRoute(pathname);

  return (
    <SearchProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset>
          <Header fixed />
          <div
            id="content"
            className={
              isFullHeight
                ? 'flex flex-1 flex-col overflow-hidden'
                : 'flex flex-1 flex-col overflow-y-auto'
            }
          >
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SearchProvider>
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
