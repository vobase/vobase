import { Status } from '@/components/ui/status'

type DeliveryVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral'

export function mapDeliveryStatus(status: string | null): { variant: DeliveryVariant; label: string } | null {
  switch (status) {
    case 'sent':
      return { variant: 'success', label: 'Sent' }
    case 'delivered':
      return { variant: 'success', label: 'Delivered' }
    case 'read':
      return { variant: 'info', label: 'Read' }
    case 'failed':
      return { variant: 'error', label: 'Failed' }
    case 'pending':
      return { variant: 'warning', label: 'Pending' }
    default:
      return null
  }
}

export function DeliveryStatusChip({ status }: { status: string | null }) {
  const mapped = mapDeliveryStatus(status)
  if (!mapped) return null
  return <Status variant={mapped.variant} label={mapped.label} />
}
