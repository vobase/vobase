import { createFileRoute } from '@tanstack/react-router';

import { ContentSection } from '@/components/content-section';
import { authClient } from '@/lib/auth-client';

function AccountPage() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <ContentSection title="Account" desc="View your account details.">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium">Email</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.email ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">Authentication</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Email verification code (OTP)
          </p>
        </div>
      </div>
    </ContentSection>
  );
}

export const Route = createFileRoute('/_app/settings/account')({
  component: AccountPage,
});
