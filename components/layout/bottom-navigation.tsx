'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  LayoutDashboard,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { APP_CONFIG } from '@/lib/config';
import type { I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  transaction: ArrowLeftRight,
  investment: TrendingUp,
  dashboard: LayoutDashboard,
  analytics: ChartNoAxesCombined,
  budget: Wallet,
};

const NAV_I18N_KEYS: Record<string, I18nKey> = {
  transaction: 'nav.transaction',
  investment: 'nav.investment',
  dashboard: 'nav.dashboard',
  analytics: 'nav.analytics',
  budget: 'nav.budget',
};

export function BottomNavigation() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label="Primary Navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto grid h-16 max-w-2xl grid-cols-5 items-center px-1 sm:px-4">
        {APP_CONFIG.navigationRoutes.map((item) => {
          const Icon = NAV_ICONS[item.id] ?? LayoutDashboard;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const isCenterDashboard = item.id === 'dashboard';
          const labelKey = NAV_I18N_KEYS[item.id];
          const label = labelKey ? t(labelKey) : item.label;

          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                isActive ? 'text-brand-primary' : 'text-ink-muted hover:text-ink'
              )}
            >
              {isCenterDashboard ? (
                <span
                  className={cn(
                    'flex h-8 w-11 items-center justify-center rounded-xl transition-colors',
                    isActive
                      ? 'bg-brand-primary text-brand-primary-foreground shadow-sm'
                      : 'border border-line bg-surface-muted text-ink group-hover:border-brand-primary/40 group-hover:text-brand-primary'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                </span>
              ) : (
                <span
                  className={cn(
                    'flex h-7 w-9 items-center justify-center rounded-lg transition-colors',
                    isActive
                      ? 'bg-brand-accent-soft text-brand-accent'
                      : 'text-ink-muted group-hover:text-ink'
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                </span>
              )}

              <span
                className={cn(
                  'max-w-full truncate whitespace-nowrap text-[11px] leading-tight tracking-tight',
                  isCenterDashboard || isActive ? 'font-semibold' : 'font-medium',
                  isActive && !isCenterDashboard ? 'text-brand-accent' : ''
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
