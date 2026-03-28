import { createFileRoute, Outlet } from '@tanstack/react-router';

function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-4">
      <div className="mb-8">
        <p className="text-[10px] font-bold tracking-[0.25em] text-muted-foreground uppercase">
          Vobase
        </p>
      </div>
      <Outlet />
      <p className="mt-8 text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Vobase
      </p>
    </div>
  );
}

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
});
