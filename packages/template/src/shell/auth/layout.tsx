import { createFileRoute, Outlet } from '@tanstack/react-router';

function AuthLayout() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[2fr_3fr]">
      <div className="hidden bg-foreground px-10 py-10 lg:flex lg:flex-col lg:justify-between">
        <p className="text-[10px] font-bold tracking-[0.25em] text-primary-foreground/70 uppercase">
          Vobase
        </p>
        <div>
          <p className="text-lg text-primary-foreground/50">Own the code.</p>
          <p className="text-lg text-primary-foreground/50">Own the data.</p>
        </div>
        <p className="text-xs text-primary-foreground/30">
          &copy; {new Date().getFullYear()} Vobase
        </p>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
});
