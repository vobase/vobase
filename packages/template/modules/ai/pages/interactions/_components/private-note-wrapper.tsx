import { LockIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface PrivateNoteWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export function PrivateNoteWrapper({
  children,
  className,
}: PrivateNoteWrapperProps) {
  return (
    <div
      className={cn(
        'relative rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/20',
        className,
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
        <LockIcon className="size-3" />
        Internal note
      </div>
      {children}
    </div>
  );
}
