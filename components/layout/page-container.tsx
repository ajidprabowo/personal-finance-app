import React from 'react';
import { cn } from '@/lib/utils';

export interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: 'narrow' | 'default' | 'wide';
}

const MAX_WIDTH_CLASSES = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-6xl',
} as const;

export function PageContainer({
  children,
  className,
  maxWidth = 'default',
}: PageContainerProps) {
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 sm:py-8', MAX_WIDTH_CLASSES[maxWidth], className)}>
      {children}
    </div>
  );
}
