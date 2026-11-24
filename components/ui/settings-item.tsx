import React from 'react';
import { cn } from '@/lib/utils';

export interface SettingsItemProps {
  label: string;
  description?: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
  layout?: 'row' | 'stack';
  className?: string;
}

export function SettingsItem({
  label,
  description,
  control,
  children,
  layout = 'row',
  className,
}: SettingsItemProps) {
  if (layout === 'stack') {
    return (
      <div className={cn('px-5 py-4', className)}>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{label}</p>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
            ) : null}
          </div>
          {control ? <div className="shrink-0">{control}</div> : null}
        </div>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {control ? <div className="shrink-0">{control}</div> : null}
      {children}
    </div>
  );
}
