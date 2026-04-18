import { Link, Outlet } from '@tanstack/react-router'
import { useRealtimeInvalidation } from './hooks/use-realtime-invalidation'

function NavItem({ to, label, exact = false }: { to: string; label: string; exact?: boolean }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className="flex items-center rounded-md px-2 py-1.5 text-sm text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
      activeProps={{ className: 'bg-accent text-foreground font-medium' }}
    >
      {label}
    </Link>
  )
}

export function AppShell() {
  useRealtimeInvalidation()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-44 flex-col border-r border-border bg-sidebar px-2 py-4 gap-0.5 shrink-0">
        <div className="px-2 py-1 mb-3">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Vobase</span>
        </div>
        <NavItem to="/" label="Inbox" exact />
        <NavItem to="/approvals" label="Approvals" />
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
