import { SendIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface StaffComposerProps {
  onSend: (content: string, isInternal: boolean) => void;
  isPending: boolean;
  error?: string | null;
  onTyping?: () => void;
}

export function StaffComposer({
  onSend,
  isPending,
  error,
  onTyping,
}: StaffComposerProps) {
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed || isPending) return;
    onSend(trimmed, isInternal);
    setContent('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t bg-background px-4 py-3">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (e.target.value.trim() && !isInternal && onTyping) onTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isInternal ? 'Write an internal note...' : 'Reply as staff...'
            }
            className={cn(
              'min-h-[56px] max-h-[120px] resize-none pr-20 text-sm',
              isInternal &&
                'border-violet-300 bg-violet-50/30 dark:border-violet-800 dark:bg-violet-950/20',
            )}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            className="h-8 gap-1.5 px-3"
            disabled={!content.trim() || isPending}
            onClick={handleSubmit}
          >
            <SendIcon className="h-3.5 w-3.5" />
            {isInternal ? 'Note' : 'Send'}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 py-0.5 text-xs font-mono">
              {typeof navigator !== 'undefined' &&
              /Mac|iPhone|iPad/.test(navigator.userAgent)
                ? '⌘'
                : 'Ctrl'}
              +Enter
            </kbd>{' '}
            to send
          </span>
          <button
            type="button"
            onClick={() => setIsInternal(!isInternal)}
            className={cn(
              'text-sm font-medium transition-colors',
              isInternal
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isInternal ? 'Switch to reply' : 'Internal note'}
          </button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
