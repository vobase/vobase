import { AlertTriangleIcon, CheckCheckIcon, CheckIcon, ClockIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface DeliveryStatusProps {
  status: string | null
  failureReason?: string | null
  className?: string
}

export function DeliveryStatus({ status, failureReason, className }: DeliveryStatusProps) {
  if (!status) return null

  if (status === 'failed') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center">
              <AlertTriangleIcon className={cn('size-3 text-destructive', className)} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs">{failureReason || 'Delivery failed'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const Icon =
    status === 'queued'
      ? ClockIcon
      : status === 'sent'
        ? CheckIcon
        : status === 'delivered' || status === 'read'
          ? CheckCheckIcon
          : null
  if (!Icon) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            <Icon className={cn('size-3', status === 'read' ? 'text-blue-500' : 'text-muted-foreground', className)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="capitalize text-xs">{status}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
