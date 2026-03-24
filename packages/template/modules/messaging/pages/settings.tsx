import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

const settingsNav = [
  { label: 'Inboxes', to: '/messaging/settings/inboxes' as const },
  { label: 'Teams', to: '/messaging/settings/teams' as const },
];

function MessagingSettingsLayout() {
  return (
    <div className="flex flex-col h-full">
      {/* Settings nav tabs */}
      <div className="flex border-b px-4">
        {settingsNav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors text-muted-foreground hover:text-foreground',
            )}
            activeProps={{
              className: 'border-b-2 border-primary text-foreground',
            }}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/settings')({
  component: MessagingSettingsLayout,
});
