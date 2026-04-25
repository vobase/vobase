/**
 * Module-level state for channel-whatsapp.
 */
import type { RealtimeService } from '~/runtime'

export interface JobQueue {
  send(name: string, data: unknown): Promise<string>
}

interface ChannelWhatsappStateDeps {
  jobs?: JobQueue | null
  realtime?: RealtimeService | null
  /** Phone number ID used when sending via Meta Graph API. Sourced from channel_instance config. */
  phoneNumberId?: string | null
  /** Meta Graph API access token. */
  accessToken?: string | null
  /** Webhook verify token (Meta hub challenge). */
  verifyToken?: string | null
}

export interface ChannelWhatsappState {
  jobs: JobQueue | null
  realtime: RealtimeService | null
  phoneNumberId: string | null
  accessToken: string | null
  verifyToken: string | null
}

export function createChannelWhatsappState(deps: ChannelWhatsappStateDeps = {}): ChannelWhatsappState {
  return {
    jobs: deps.jobs ?? null,
    realtime: deps.realtime ?? null,
    phoneNumberId: deps.phoneNumberId ?? null,
    accessToken: deps.accessToken ?? null,
    verifyToken: deps.verifyToken ?? null,
  }
}

let _currentChannelWhatsappState: ChannelWhatsappState | null = null

export function installChannelWhatsappState(state: ChannelWhatsappState): void {
  _currentChannelWhatsappState = state
}

export function __resetChannelWhatsappStateForTests(): void {
  _currentChannelWhatsappState = null
}

function current(): ChannelWhatsappState {
  if (!_currentChannelWhatsappState) {
    throw new Error('channel-whatsapp: state not installed — call installChannelWhatsappState() in module init')
  }
  return _currentChannelWhatsappState
}

export function requireJobs(): JobQueue {
  const s = current()
  if (!s.jobs) throw new Error('channel-whatsapp: jobQueue not initialised')
  return s.jobs
}
export function requireRealtime(): RealtimeService {
  const s = current()
  if (!s.realtime) throw new Error('channel-whatsapp: realtime not initialised')
  return s.realtime
}

export function requirePhoneNumberId(): string {
  const s = _currentChannelWhatsappState
  return s?.phoneNumberId ?? process.env.WA_PHONE_NUMBER_ID ?? ''
}
export function requireAccessToken(): string {
  const s = _currentChannelWhatsappState
  return s?.accessToken ?? process.env.WA_ACCESS_TOKEN ?? ''
}

const _warned = { verifyToken: false }

function devFallback(
  value: string | undefined,
  fallback: string,
  errorMsg: string,
  warnMsg: string,
  key: keyof typeof _warned,
): string {
  if (value) return value
  if (process.env.NODE_ENV === 'production') throw new Error(errorMsg)
  if (!_warned[key]) {
    console.warn(warnMsg)
    _warned[key] = true
  }
  return fallback
}

export function requireVerifyToken(): string {
  const s = _currentChannelWhatsappState
  return devFallback(
    s?.verifyToken ?? process.env.WA_VERIFY_TOKEN,
    'dev-verify-token',
    'channel-whatsapp: WA_VERIFY_TOKEN is required in production',
    '[channel-whatsapp] WARNING: WA_VERIFY_TOKEN not set — using dev fallback. Set it in production.',
    'verifyToken',
  )
}
