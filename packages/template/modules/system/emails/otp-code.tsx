import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

import { productName } from '../../../vobase.config'

interface OtpCodeEmailProps {
  otp: string
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'
}

const TYPE_LABELS: Record<OtpCodeEmailProps['type'], string> = {
  'sign-in': 'Sign in',
  'email-verification': 'Email verification',
  'forget-password': 'Password reset',
  'change-email': 'Email change',
}

export function OtpCodeEmail({ otp, type }: OtpCodeEmailProps) {
  const label = TYPE_LABELS[type]

  return (
    <Html>
      <Head />
      <Preview>
        {label} code: {otp}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>{productName}</Text>
          <Heading style={heading}>{label}</Heading>
          <Text style={text}>Enter the following code to continue:</Text>
          <Section style={codeSection}>
            <Text style={code}>{otp}</Text>
          </Section>
          <Text style={footer}>This code expires in 5 minutes. If you didn't request this, ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const container: React.CSSProperties = {
  margin: '40px auto',
  padding: '32px 24px',
  maxWidth: '400px',
  backgroundColor: '#ffffff',
  borderRadius: '8px',
}

const heading: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 8px',
}

const text: React.CSSProperties = {
  fontSize: '14px',
  color: '#4b5563',
  margin: '0 0 24px',
}

const codeSection: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '0 0 24px',
  padding: '16px',
  backgroundColor: '#f3f4f6',
  borderRadius: '6px',
}

const code: React.CSSProperties = {
  fontSize: '32px',
  fontWeight: 700,
  letterSpacing: '6px',
  color: '#111827',
  margin: 0,
}

const brand: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#9ca3af',
  margin: '0 0 16px',
}

const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: 0,
}
