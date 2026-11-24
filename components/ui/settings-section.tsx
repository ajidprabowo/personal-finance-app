import React from 'react';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { cn } from '@/lib/utils';

export interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section id={id} className={cn('space-y-3', className)}>
      <SectionHeader title={title} description={description} action={action} />
      <Card padding="none" className="divide-y divide-line overflow-hidden">
        {children}
      </Card>
    </section>
  );
}
