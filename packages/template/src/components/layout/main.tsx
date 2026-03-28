import { cn } from '@/lib/utils';

type MainProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean;
};

export function Main({ fixed, className, ...props }: MainProps) {
  return (
    <main
      data-layout={fixed ? 'fixed' : 'auto'}
      className={cn(
        'px-4 py-6',
        fixed && 'flex grow flex-col overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}
