import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router';

const tabs = [
  { label: 'Agents', to: '/ai/agents' },
  { label: 'Evals', to: '/ai/evals' },
  { label: 'Guardrails', to: '/ai/guardrails' },
  { label: 'Memory', to: '/ai/memory' },
] as const;

function AILayout() {
  const matchRoute = useMatchRoute();

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => {
            const isActive = matchRoute({ to: tab.to, fuzzy: true });
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/ai')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/ai') {
      throw redirect({ to: '/ai/agents' });
    }
  },
  component: AILayout,
});
