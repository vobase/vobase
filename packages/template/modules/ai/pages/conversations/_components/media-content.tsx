import { FileIcon } from 'lucide-react';
import { useState } from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

interface MediaItem {
  type: string;
  url: string;
  mimeType: string;
  filename?: string;
}

interface MediaContentProps {
  contentType: string;
  media: MediaItem[];
  className?: string;
}

function parseMedia(contentData: Record<string, unknown> | null): MediaItem[] {
  if (!contentData) return [];
  const raw = contentData.media;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is MediaItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as MediaItem).url === 'string',
  );
}

// ─── Component ────────────────────────────────────────────────────────

export function MediaContent({
  contentType,
  media,
  className,
}: MediaContentProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (media.length === 0) return null;

  // ── Image ──────────────────────────────────────────────────────────
  if (contentType === 'image') {
    return (
      <>
        <div className={cn('flex flex-wrap gap-1.5 mt-1.5', className)}>
          {media.map((item, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: media items have no stable id
              key={i}
              type="button"
              onClick={() => setLightboxUrl(item.url)}
              className="block overflow-hidden rounded-md border hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={item.url}
                alt={item.filename ?? 'Image'}
                className="max-w-[280px] max-h-64 object-cover"
              />
            </button>
          ))}
        </div>
        <Dialog
          open={!!lightboxUrl}
          onOpenChange={(open) => !open && setLightboxUrl(null)}
        >
          <DialogContent className="max-w-3xl p-2">
            <DialogTitle className="sr-only">Image preview</DialogTitle>
            {lightboxUrl && (
              <img
                src={lightboxUrl}
                alt="Full size"
                className="w-full h-auto max-h-[80vh] object-contain rounded-md"
              />
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ── Audio / voice ──────────────────────────────────────────────────
  if (contentType === 'audio') {
    return (
      <div className={cn('flex flex-col gap-1.5 mt-1.5', className)}>
        {media.map((item) => (
          // biome-ignore lint/a11y/useMediaCaption: captions not available for user-uploaded voice messages
          <audio
            key={item.url}
            controls
            src={item.url}
            className="h-8 max-w-[280px] w-full"
          />
        ))}
      </div>
    );
  }

  // ── Video ──────────────────────────────────────────────────────────
  if (contentType === 'video') {
    return (
      <div className={cn('flex flex-wrap gap-1.5 mt-1.5', className)}>
        {media.map((item) => (
          // biome-ignore lint/a11y/useMediaCaption: captions not available for user-uploaded video messages
          <video
            key={item.url}
            src={item.url}
            controls
            className="max-w-[280px] max-h-48 rounded-md border"
          />
        ))}
      </div>
    );
  }

  // ── Document ───────────────────────────────────────────────────────
  if (contentType === 'document') {
    return (
      <div className={cn('flex flex-col gap-1.5 mt-1.5', className)}>
        {media.map((item, i) => (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: media items have no stable id
            key={i}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            download={item.filename}
            className="no-underline w-fit"
          >
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs hover:bg-muted transition-colors max-w-[280px]">
              <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">
                {item.filename ?? 'Document'}
              </span>
            </div>
          </a>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Helper export ────────────────────────────────────────────────────

export { parseMedia };
