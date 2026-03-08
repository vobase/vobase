import { createFileRoute, Outlet } from '@tanstack/react-router';

export type SystemLayoutPageProps = Record<string, never>;

export function SystemLayoutPage(_: Readonly<SystemLayoutPageProps>) {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/system')({
  component: SystemLayoutPage,
});
