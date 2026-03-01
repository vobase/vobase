import { Outlet, createFileRoute } from '@tanstack/react-router';

export interface SystemLayoutPageProps {}

export function SystemLayoutPage(_: Readonly<SystemLayoutPageProps>) {
  return <Outlet />;
}

export const Route = createFileRoute('/system')({
  component: SystemLayoutPage,
});
