import {
  AlertTriangleIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  RefreshCwIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface DeliveryStatusProps {
  status: string | null;
  failureReason?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function DeliveryStatus({
  status,
  failureReason,
  onRetry,
  className,
}: DeliveryStatusProps) {
  if (!status) return null;

  if (status === 'failed') {
    return (
      <TooltipProvider>
        <span className="inline-flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangleIcon
                className={cn(
                  'size-3 text-destructive cursor-default',
                  className,
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">
                {failureReason || 'Delivery failed'}
              </p>
            </TooltipContent>
          </Tooltip>
          {onRetry && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 text-destructive hover:text-destructive"
                  onClick={onRetry}
                >
                  <RefreshCwIcon className="size-2.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Retry delivery</p>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </TooltipProvider>
    );
  }

  const Icon =
    status === 'queued'
      ? ClockIcon
      : status === 'sent'
        ? CheckIcon
        : status === 'delivered' || status === 'read'
          ? CheckCheckIcon
          : null;

  if (!Icon) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            <Icon
              className={cn(
                'size-3',
                status === 'read' ? 'text-blue-500' : 'text-muted-foreground',
                className,
              )}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="capitalize">{status}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
