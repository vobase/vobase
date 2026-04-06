import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import {
  BellIcon,
  KeyIcon,
  MonitorIcon,
  PaletteIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react';

const settingsNav = [
  { label: 'Profile', to: '/settings/profile', icon: UserIcon },
  { label: 'Account', to: '/settings/account', icon: WrenchIcon },
  { label: 'Appearance', to: '/settings/appearance', icon: PaletteIcon },
  { label: 'Notifications', to: '/settings/notifications', icon: BellIcon },
  { label: 'Display', to: '/settings/display', icon: MonitorIcon },
  { label: 'API Keys', to: '/settings/api-keys', icon: KeyIcon },
] as const;

function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 gap-8 p-6">
      <nav className="w-[200px] shrink-0">
        <p className="mb-2 px-2 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Settings
        </p>
        <ul className="flex flex-col gap-0.5">
          {settingsNav.map(({ label, to, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                activeProps={{
                  className:
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-accent text-accent-foreground font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ location }) => {
    if (
      location.pathname === '/settings' ||
      location.pathname === '/settings/'
    ) {
      throw redirect({ to: '/settings/profile' });
    }
  },
  component: SettingsLayout,
});
