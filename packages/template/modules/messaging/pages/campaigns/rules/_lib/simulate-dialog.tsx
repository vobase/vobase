import { useMutation } from '@tanstack/react-query';
import { FlaskConicalIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { messagingClient } from '@/lib/api-client';
import { ChaserTimeline, type SimulateResult } from './chaser-timeline';

interface SimulateDialogProps {
  ruleId: string;
  ruleName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SimulateDialog({
  ruleId,
  ruleName,
  open,
  onOpenChange,
}: SimulateDialogProps) {
  const simulateMutation = useMutation({
    mutationFn: async (): Promise<SimulateResult> => {
      const res = await messagingClient.automation.rules[':id'].simulate.$post({
        param: { id: ruleId },
      });
      if (!res.ok) throw new Error('Simulation failed');
      return res.json() as Promise<SimulateResult>;
    },
    onError: () => toast.error('Failed to run simulation'),
  });

  function handleOpenChange(v: boolean) {
    onOpenChange(v);
    if (v && !simulateMutation.data && !simulateMutation.isPending) {
      simulateMutation.mutate();
    }
  }

  function handleOpen() {
    onOpenChange(true);
    simulateMutation.mutate();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleOpen}
      >
        <FlaskConicalIcon className="size-3.5" />
        Simulate
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConicalIcon className="size-4" />
              Simulation — {ruleName}
            </DialogTitle>
          </DialogHeader>

          {simulateMutation.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : simulateMutation.data ? (
            <ChaserTimeline result={simulateMutation.data} />
          ) : simulateMutation.isError ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-destructive">Simulation failed.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => simulateMutation.mutate()}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
