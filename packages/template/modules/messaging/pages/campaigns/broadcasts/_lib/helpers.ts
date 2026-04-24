// Shared broadcast UI helpers

export type StatusVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

export function broadcastStatusVariant(status: string): StatusVariant {
  switch (status) {
    case 'draft':
      return 'default'
    case 'scheduled':
      return 'info'
    case 'sending':
      return 'warning'
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'paused':
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
