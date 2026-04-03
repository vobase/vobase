import { BookOpenIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useStaffChatStore } from '@/stores/staff-chat-store';

interface KbCurationOverlayProps {
  messageId: string;
  messageText: string;
}

/**
 * Checkbox overlay on assistant messages when KB curation mode is active.
 */
export function KbCurationOverlay({ messageId }: KbCurationOverlayProps) {
  const isSelected = useStaffChatStore((s) =>
    s.kbSelectedMessages.has(messageId),
  );
  const toggleKbMessage = useStaffChatStore((s) => s.toggleKbMessage);

  return (
    <div className="absolute -left-7 top-1/2 -translate-y-1/2">
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => toggleKbMessage(messageId)}
        className="h-4 w-4"
      />
    </div>
  );
}

/**
 * Toggle button for KB curation mode in conversation header.
 */
export function KbCurationToggle() {
  const isActive = useStaffChatStore((s) => s.kbCurationActive);
  const toggle = useStaffChatStore((s) => s.toggleKbCuration);

  return (
    <Button
      variant={isActive ? 'secondary' : 'ghost'}
      size="sm"
      onClick={toggle}
      className="gap-1.5"
    >
      <BookOpenIcon className="h-3.5 w-3.5" />
      <span className="text-xs">{isActive ? 'Done' : 'Curate KB'}</span>
    </Button>
  );
}

/**
 * Sticky bottom bar with "Add N messages to KB" button.
 */
export function KbCurationBar() {
  const selectedMessages = useStaffChatStore((s) => s.kbSelectedMessages);
  const clearKbSelection = useStaffChatStore((s) => s.clearKbSelection);
  const [isPending, setIsPending] = useState(false);

  if (selectedMessages.size === 0) return null;

  const handleSubmit = async () => {
    setIsPending(true);
    try {
      // Batch submit to KB API
      // biome-ignore lint/style/noRestrictedGlobals: KB batch submit not in RPC client
      const res = await fetch('/api/knowledge-base/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messageIds: [...selectedMessages],
        }),
      });

      if (res.ok) {
        toast.success(
          `Added ${selectedMessages.size} message${selectedMessages.size > 1 ? 's' : ''} to Knowledge Base`,
        );
        clearKbSelection();
      } else {
        toast.error('Failed to add messages to Knowledge Base');
      }
    } catch {
      toast.error('Failed to add messages to Knowledge Base');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-background px-4 py-2">
      <span className="text-xs text-muted-foreground">
        {selectedMessages.size} message
        {selectedMessages.size > 1 ? 's' : ''} selected
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={clearKbSelection}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Adding...' : 'Add to KB'}
        </Button>
      </div>
    </div>
  );
}
