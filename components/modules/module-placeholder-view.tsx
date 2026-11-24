'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  LayoutDashboard,
  Settings2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

export type ModuleKind = 'transactions' | 'investments' | 'dashboard' | 'analytics' | 'budget';

interface ModulePlaceholderViewProps {
  module: ModuleKind;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  plannedSections: Array<{ label: string; detail: string }>;
}

const MODULE_ICONS: Record<ModuleKind, React.ReactNode> = {
  transactions: <ArrowLeftRight className="h-5 w-5" aria-hidden="true" />,
  investments: <TrendingUp className="h-5 w-5" aria-hidden="true" />,
  dashboard: <LayoutDashboard className="h-5 w-5" aria-hidden="true" />,
  analytics: <ChartNoAxesCombined className="h-5 w-5" aria-hidden="true" />,
  budget: <Wallet className="h-5 w-5" aria-hidden="true" />,
};

export function ModulePlaceholderView({
  module,
  title,
  description,
  emptyTitle,
  emptyDescription,
  plannedSections,
}: ModulePlaceholderViewProps) {
  return (
    <AppLayout>
      <PageContainer>
        <PageHeader
          title={title}
          description={description}
          action={
            <Link href="/profile">
              <Button variant="outline" size="sm">
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Configure in Settings</span>
              </Button>
            </Link>
          }
        />

        <div className="space-y-6">
          <EmptyState
            icon={MODULE_ICONS[module]}
            title={emptyTitle}
            description={emptyDescription}
            note="Local IndexedDB schema and repositories are initialized. Module workflows will be added in a later stage."
            action={
              <Link href="/profile#accounts">
                <Button variant="secondary" size="sm">
                  Review Accounts &amp; Preferences
                </Button>
              </Link>
            }
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plannedSections.map((section) => (
              <Card key={section.label} padding="md" className="flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-ink">{section.label}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{section.detail}</p>
                </div>
                <p className="mt-4 font-mono text-[11px] text-ink-muted/80">
                  Awaiting Stage 3+ implementation
                </p>
              </Card>
            ))}
          </div>
        </div>
      </PageContainer>
    </AppLayout>
  );
}
