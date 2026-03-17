import { createFileRoute } from '@tanstack/react-router';
import { BuildingIcon } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';

export function OrganizationPage() {
  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Organization</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage your organization settings.
        </p>
      </div>

      <EmptyState
        icon={BuildingIcon}
        title="Organization settings unavailable"
        description="Organization settings are available when organization mode is enabled in your vobase.config.ts."
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/organization')({
  component: OrganizationPage,
});
