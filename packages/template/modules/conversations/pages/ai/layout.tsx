import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router';

const tabs = [
  { label: 'AI Agents', to: '/conversations/ai/agents' },
  { label: 'Evals', to: '/conversations/ai/evals' },
  { label: 'Guardrails', to: '/conversations/ai/guardrails' },
  { label: 'Memory', to: '/conversations/ai/memory' },
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

// biome-ignore lint/suspicious/noExplicitAny: tsr generate doesn't register sub-layouts from virtual routes
export const Route = createFileRoute('/_app/conversations/ai' as any)({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/conversations/ai') {
      throw redirect({ to: '/conversations/ai/agents' });
    }
  },
  component: AILayout,
});
