/**
 * SMTP sender. If SMTP_HOST is unset, falls back to console logging (dev-friendly).
 *
 * Env vars:
 *   SMTP_HOST (default: localhost)
 *   SMTP_PORT (default: 1025 — maildev)
 *   SMTP_FROM (default: noreply@vobase.local)
 *   SMTP_USER (optional)
 *   SMTP_PASS (optional)
 */

import { logger } from '@vobase/core'
import nodemailer, { type Transporter } from 'nodemailer'

export interface EmailPayload {
  to: string
  subject: string
  html: string
}

let cachedTransporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (cachedTransporter) return cachedTransporter
  const host = process.env.SMTP_HOST
  if (!host) return null

  const port = Number(process.env.SMTP_PORT ?? 1025)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: user && pass ? { user, pass } : undefined,
  })
  return cachedTransporter
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const transporter = getTransporter()
  if (!transporter) {
    logger.info('[email:console] SMTP_HOST unset — logging email instead', {
      to: payload.to,
      subject: payload.subject,
    })
    console.log(`[email:console] to=${payload.to} subject=${payload.subject}\n${payload.html}`)
    return
  }

  const from = process.env.SMTP_FROM ?? 'noreply@vobase.local'
  await transporter.sendMail({ from, ...payload })
}
