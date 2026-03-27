import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import {
  BuildingIcon,
  CableIcon,
  KeyIcon,
  PaletteIcon,
  UserIcon,
} from 'lucide-react';

const settingsNav = [
  { label: 'Profile', to: '/settings/profile', icon: UserIcon },
  { label: 'Appearance', to: '/settings/appearance', icon: PaletteIcon },
  { label: 'API Keys', to: '/settings/api-keys', icon: KeyIcon },
  { label: 'Integrations', to: '/settings/integrations', icon: CableIcon },
  { label: 'Organization', to: '/settings/organization', icon: BuildingIcon },
] as const;

function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 gap-8 p-6">
      <nav className="w-[200px] shrink-0">
        <p className="mb-2 px-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
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
