import { useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Search } from '@/components/layout/search';
import { TopNav, type TopNavLink } from '@/components/layout/top-nav';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { sidebarNavGroups } from '@/constants/navigation';
import { cn } from '@/lib/utils';
import { ThemeSwitch } from '@/shell/theme-switch';

function useTopNavLinks(): TopNavLink[] {
  const { pathname } = useLocation();

  for (const group of sidebarNavGroups) {
    // Only show TopNav for groups with 2+ items
    if (group.items.length < 2) continue;

    const match = group.items.find((item) => {
      const url = 'url' in item ? item.url : undefined;
      if (!url) return false;
      return pathname === url || pathname.startsWith(`${url}/`);
    });

    if (match) {
      return group.items
        .filter(
          (item): item is typeof item & { url: string } =>
            'url' in item && !!item.url,
        )
        .map((item) => ({
          title: item.title,
          href: item.url,
          isActive:
            pathname === item.url || pathname.startsWith(`${item.url}/`),
        }));
    }
  }

  return [];
}

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean;
};

export function Header({ className, fixed, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0);
  const topNavLinks = useTopNavLinks();

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop);
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    return () => document.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'z-50 flex h-16 shrink-0 items-center gap-2',
        fixed && 'sticky top-0',
        offset > 10 && fixed ? 'shadow-sm' : 'shadow-none',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'relative flex h-full w-full items-center gap-3 px-4 sm:gap-4',
          offset > 10 &&
            fixed &&
            'after:absolute after:inset-0 after:-z-10 after:bg-background/80 after:backdrop-blur-lg',
        )}
      >
        <SidebarTrigger variant="outline" className="max-md:scale-125" />
        <Separator orientation="vertical" className="h-4!" />
        {topNavLinks.length > 0 && <TopNav links={topNavLinks} />}
        <div className="ms-auto flex items-center gap-2">
          <Search />
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
