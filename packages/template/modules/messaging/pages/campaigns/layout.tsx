import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function CampaignsLayout() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute('/_app/campaigns')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/campaigns') {
      throw redirect({ to: '/campaigns/broadcasts' });
    }
  },
  component: CampaignsLayout,
});
