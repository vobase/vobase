import {
  Body,
  Container,
  Button as EmailButton,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components';

import { productName } from '../../../vobase.config';

interface InvitationEmailProps {
  inviterName: string;
  organizationName: string;
  signInUrl: string;
}

export function InvitationEmail({
  inviterName,
  organizationName,
  signInUrl,
}: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to {organizationName}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>{productName}</Text>
          <Heading style={heading}>You've been invited</Heading>
          <Text style={text}>
            <strong>{inviterName}</strong> invited you to join{' '}
            <strong>{organizationName}</strong>.
          </Text>
          <EmailButton style={button} href={signInUrl}>
            Sign in &amp; accept invitation
          </EmailButton>
          <Text style={footer}>
            If you weren't expecting this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container: React.CSSProperties = {
  margin: '40px auto',
  padding: '32px 24px',
  maxWidth: '400px',
  backgroundColor: '#ffffff',
  borderRadius: '8px',
};

const heading: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 8px',
};

const text: React.CSSProperties = {
  fontSize: '14px',
  color: '#4b5563',
  margin: '0 0 16px',
};

const brand: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#9ca3af',
  margin: '0 0 16px',
};

const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#111827',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '10px 24px',
  borderRadius: '6px',
  margin: '0 0 16px',
};

const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: 0,
};
