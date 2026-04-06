import { Link, type LinkProps } from '@tanstack/react-router';
import { Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface TopNavLink {
  title: string;
  href: string;
  isActive: boolean;
  disabled?: boolean;
}

interface TopNavProps extends React.HTMLAttributes<HTMLElement> {
  links: TopNavLink[];
}

export type { TopNavLink };

export function TopNav({ className, links, ...props }: TopNavProps) {
  return (
    <>
      <div className="lg:hidden">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" className="md:size-7">
              <Menu />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            {links.map(({ title, href, isActive, disabled }) => (
              <DropdownMenuItem key={`${title}-${href}`} asChild>
                <Link
                  to={href as LinkProps['to']}
                  className={!isActive ? 'text-muted-foreground' : ''}
                  disabled={disabled}
                >
                  {title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav
        className={cn('hidden items-center gap-4 lg:flex xl:gap-6', className)}
        {...props}
      >
        {links.map(({ title, href, isActive, disabled }) => (
          <Link
            key={`${title}-${href}`}
            to={href as LinkProps['to']}
            disabled={disabled}
            className={cn(
              'text-sm font-medium transition-colors hover:text-primary',
              !isActive && 'text-muted-foreground',
            )}
          >
            {title}
          </Link>
        ))}
      </nav>
    </>
  );
}
