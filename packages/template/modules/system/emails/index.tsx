import { render } from '@react-email/components';

import { OtpCodeEmail } from './otp-code';

export async function renderOtpEmail(props: {
  otp: string;
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
}): Promise<string> {
  return render(<OtpCodeEmail {...props} />);
}
