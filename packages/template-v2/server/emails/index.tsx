import { render } from '@react-email/components'

import { InvitationEmail, type InvitationEmailProps } from './invitation'
import { OtpCodeEmail, type OtpCodeEmailProps } from './otp-code'

export async function renderOtpEmail(props: OtpCodeEmailProps): Promise<string> {
  return render(<OtpCodeEmail {...props} />)
}

export async function renderInvitationEmail(props: InvitationEmailProps): Promise<string> {
  return render(<InvitationEmail {...props} />)
}
