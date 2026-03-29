import { AuiIf, ComposerPrimitive } from '@assistant-ui/react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import type { FC } from 'react';

import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { Button } from '@/components/ui/button';

interface VobaseComposerProps {
  /** Called on each keystroke for typing indicator */
  onInputChange?: () => void;
}

export const VobaseComposer: FC<VobaseComposerProps> = ({ onInputChange }) => {
  return (
    <div className="border-t bg-background px-4 pb-4 pt-3">
      <div className="mx-auto max-w-2xl">
        <ComposerPrimitive.Root className="relative flex w-full flex-col">
          <div className="flex w-full flex-col gap-2 rounded-xl border bg-muted/30 p-2.5 transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20">
            <ComposerPrimitive.Input
              placeholder="Type a message..."
              className="max-h-32 min-h-10 w-full resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
              rows={1}
              autoFocus
              aria-label="Message input"
              onChange={onInputChange}
            />
            <div className="relative flex items-center justify-end">
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send asChild>
                  <TooltipIconButton
                    tooltip="Send message"
                    side="bottom"
                    type="button"
                    variant="default"
                    size="icon"
                    className="size-8 rounded-full"
                    aria-label="Send message"
                  >
                    <ArrowUpIcon className="size-4" />
                  </TooltipIconButton>
                </ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(s) => s.thread.isRunning}>
                <ComposerPrimitive.Cancel asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    className="size-8 rounded-full"
                    aria-label="Stop generating"
                  >
                    <SquareIcon className="size-3 fill-current" />
                  </Button>
                </ComposerPrimitive.Cancel>
              </AuiIf>
            </div>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </div>
  );
};
