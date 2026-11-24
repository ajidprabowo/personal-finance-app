import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  note?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  note,
  className,
}: EmptyStateProps) {
  return (
    <Card padding="lg" className={cn('text-center', className)}>
      <div className="mx-auto flex max-w-md flex-col items-center py-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-muted text-ink-muted">
          {icon}
        </div>
        <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>
        {note ? <p className="mt-3 text-xs text-ink-muted/80">{note}</p> : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </Card>
  );
}
