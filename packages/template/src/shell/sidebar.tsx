import { Link } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { moduleNames, shellNavigation } from '@/data/mockData';

export interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: Readonly<SidebarProps>) {
  return (
    <aside
      className={`border-r bg-sidebar px-4 py-5 ${className ?? ''}`.trim()}
    >
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Vobase
      </p>
      <h1 className="mt-2 text-xl font-semibold">Workspace</h1>

      <nav className="mt-6 flex flex-col gap-1">
        {shellNavigation.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeProps={{ className: 'bg-sidebar-primary text-sidebar-primary-foreground' }}
            inactiveProps={{ className: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground' }}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <Separator className="my-6" />

      <section>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          Modules
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {moduleNames.map((moduleName) => (
            <li key={moduleName}>
              <Badge variant="secondary">{moduleName}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
