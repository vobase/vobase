/**
 * Shared chat-link helpers for the web channel. Keeps the embed sheet and
 * the row "Open" button on the same origin convention so they don't drift
 * apart when the dashboard and chat-widget origins diverge.
 */
export function chatUrlFor(channelInstanceId: string): string {
  return `${window.location.origin}/chat/${encodeURIComponent(channelInstanceId)}`
}

export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
