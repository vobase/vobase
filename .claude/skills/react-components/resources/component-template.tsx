import type React from 'react';

import { cn } from '@/lib/utils';

// Use a valid identifier like 'StitchComponent' as the placeholder.
interface StitchComponentProps {
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export const StitchComponent: React.FC<StitchComponentProps> = ({
  children,
  className = '',
  ...props
}) => {
  return (
    <div className={cn('relative', className)} {...props}>
      {children}
    </div>
  );
};

export default StitchComponent;
