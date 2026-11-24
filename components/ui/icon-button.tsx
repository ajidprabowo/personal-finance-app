'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

const VARIANT_CLASSES: Record<NonNullable<IconButtonProps['variant']>, string> = {
  outline: 'border border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink',
  ghost: 'border border-transparent bg-transparent text-ink-muted hover:bg-surface-muted hover:text-ink',
  danger: 'border border-status-danger/30 bg-surface text-status-danger hover:bg-status-danger/10',
};

const SIZE_CLASSES: Record<NonNullable<IconButtonProps['size']>, string> = {
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
};

export function IconButton({
  label,
  variant = 'outline',
  size = 'md',
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
