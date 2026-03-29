import { LockIcon } from 'lucide-react';

import { MessageResponse } from '@/components/ai-elements/message';
import type { NormalizedMessage } from '@/lib/normalize-message';

interface InternalNoteProps {
  message: NormalizedMessage;
}

/**
 * Visually distinct rendering for internal (staff-only) notes.
 * Muted background, lock icon, "Internal note by [Name]" label.
 */
export function InternalNote({ message }: InternalNoteProps) {
  const staffName = message.metadata.staffName ?? 'Staff';
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/30">
      <div className="flex items-center gap-1.5 mb-1">
        <LockIcon className="h-3 w-3 text-violet-500" />
        <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">
          Internal note by {staffName}
        </span>
      </div>
      <div className="pl-[18px] prose-sm prose-neutral dark:prose-invert max-w-none [&_p]:text-sm">
        <MessageResponse>{text}</MessageResponse>
      </div>
    </div>
  );
}
