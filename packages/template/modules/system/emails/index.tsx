import { render } from '@react-email/components';

import { InvitationEmail } from './invitation';
import { OtpCodeEmail } from './otp-code';

export async function renderOtpEmail(props: {
  otp: string;
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
}): Promise<string> {
  return render(<OtpCodeEmail {...props} />);
}

export async function renderInvitationEmail(props: {
  inviterName: string;
  organizationName: string;
  signInUrl: string;
}): Promise<string> {
  return render(<InvitationEmail {...props} />);
}
