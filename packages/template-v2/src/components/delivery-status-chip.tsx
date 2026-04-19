import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status'

type DeliveryVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

function mapDeliveryStatus(status: string | null): { variant: DeliveryVariant; label: string } | null {
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

interface Props {
  status: string | null
}

export function DeliveryStatusChip({ status }: Props) {
  const mapped = mapDeliveryStatus(status)
  if (!mapped) return null
  return (
    <Status variant={mapped.variant}>
      <StatusIndicator />
      <StatusLabel>{mapped.label}</StatusLabel>
    </Status>
  )
}

export { mapDeliveryStatus }
