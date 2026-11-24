'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export function Input({
  label,
  helperText,
  error,
  id,
  className,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={cn(
          'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-status-danger' : 'border-line focus:border-brand-accent',
          className
        )}
        {...props}
      />
      {error ? (
        <p className="mt-1 text-xs text-status-danger">{error}</p>
      ) : helperText ? (
        <p className="mt-1 text-xs text-ink-muted">{helperText}</p>
      ) : null}
    </div>
  );
}
