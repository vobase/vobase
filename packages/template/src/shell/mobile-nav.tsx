import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import { useEffect } from 'react';

import { sidebarNavigation } from '@/constants/navigation';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  /** Number of escalated conversations awaiting human attention */
  escalationCount?: number;
}

export function MobileNav({
  isOpen,
  onClose,
  escalationCount = 0,
}: Readonly<MobileNavProps>) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 lg:hidden',
          isOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200 lg:hidden',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex h-12 items-center justify-between border-b px-4">
          <span className="text-sm font-semibold tracking-tight">
            Workspace
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="Close navigation menu"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="overflow-y-auto py-3">
          {sidebarNavigation.map((group, groupIdx) => (
            <div key={group.label} className={cn(groupIdx > 0 && 'mt-4')}>
              <p className="mb-1 px-4 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const badge =
                    item.to === '/sessions' && escalationCount > 0
                      ? escalationCount
                      : 0;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={onClose}
                        activeProps={{
                          className: 'bg-accent text-accent-foreground',
                        }}
                        inactiveProps={{
                          className:
                            'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        }}
                        className="mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                        {badge > 0 && (
                          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-medium text-destructive-foreground">
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}
