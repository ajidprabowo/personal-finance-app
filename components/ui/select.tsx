'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options?: SelectOption[];
}

export function Select({
  label,
  helperText,
  error,
  options,
  id,
  className,
  children,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={selectId} className="mb-1.5 block text-xs font-medium text-ink">
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={cn(
          'h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-status-danger' : 'border-line focus:border-brand-accent',
          className
        )}
        {...props}
      >
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
      {error ? (
        <p className="mt-1 text-xs text-status-danger">{error}</p>
      ) : helperText ? (
        <p className="mt-1 text-xs text-ink-muted">{helperText}</p>
      ) : null}
    </div>
  );
}
