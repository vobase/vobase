import type * as React from 'react';

import { cn } from '../../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...props }: Readonly<CardProps>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, ...props }: Readonly<CardHeaderProps>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 p-6', className)}
      {...props}
    />
  );
}

export interface CardTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle({ className, ...props }: Readonly<CardTitleProps>) {
  return (
    <h3
      className={cn('leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export interface CardDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

export function CardDescription({
  className,
  ...props
}: Readonly<CardDescriptionProps>) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

export interface CardContentProps
  extends React.HTMLAttributes<HTMLDivElement> {}

export function CardContent({
  className,
  ...props
}: Readonly<CardContentProps>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardFooter({ className, ...props }: Readonly<CardFooterProps>) {
  return (
    <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
  );
}
