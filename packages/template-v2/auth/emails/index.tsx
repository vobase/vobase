import { render } from '@react-email/components'

import { InvitationEmail, type InvitationEmailProps } from './invitation'
import { OtpCodeEmail, type OtpCodeEmailProps } from './otp-code'

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function renderOtpEmail(props: OtpCodeEmailProps): Promise<string> {
  return render(<OtpCodeEmail {...props} />)
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function renderInvitationEmail(props: InvitationEmailProps): Promise<string> {
  return render(<InvitationEmail {...props} />)
}
