import { Link } from '@tanstack/react-router';
import { moduleNames, shellNavigation } from '../data/mockData';

export interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: Readonly<SidebarProps>) {
  return (
    <aside className={`border-r border-border bg-card/80 px-4 py-5 backdrop-blur ${className ?? ''}`.trim()}>
      <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Vobase</p>
      <h1 className="mt-2 text-2xl font-semibold">Workspace</h1>

      <nav className="mt-8 space-y-2">
        {shellNavigation.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeProps={{ className: 'bg-primary text-primary-foreground' }}
            className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="mt-10">
        <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Modules</p>
        <ul className="mt-3 space-y-2 text-sm">
          {moduleNames.map((moduleName) => (
            <li key={moduleName} className="rounded-md border border-border/80 bg-background/70 px-3 py-2">
              {moduleName}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
