'use client';

import React, { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { PrivacyModeToggle } from '@/components/layout/privacy-mode-toggle';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useI18n } from '@/hooks/use-i18n';
import { APP_CONFIG } from '@/lib/config';
import { cn } from '@/lib/utils';

const emptySubscribe = () => () => {};

function getTimeGreeting(language: string | undefined, timezone?: string): string {
  let hour = new Date().getHours();
  if (timezone) {
    try {
      const hourStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(new Date());
      const parsed = Number(hourStr);
      if (Number.isFinite(parsed)) hour = parsed;
    } catch {
      // Fallback to browser local hour
    }
  }
  if (language === 'id') {
    if (hour < 11) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 18) return 'Selamat sore';
    return 'Selamat malam';
  }
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedToday(language: string | undefined, timezone?: string): string {
  const locale = language === 'id' ? 'id-ID' : 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date());
  }
}

export function AppHeader() {
  const pathname = usePathname();
  const { preferences } = useBootstrap();
  const { t } = useI18n();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const isProfileActive = pathname === '/profile';

  const greetingText = useMemo(() => {
    if (!isClient) return '\u00A0';
    const base = getTimeGreeting(preferences?.language, preferences?.timezone);
    const firstName = preferences?.profileName?.trim().split(/\s+/)[0];
    return firstName ? `${base}, ${firstName}` : base;
  }, [isClient, preferences?.language, preferences?.profileName, preferences?.timezone]);

  const currentDateText = useMemo(() => {
    if (!isClient) return '\u00A0';
    return getFormattedToday(preferences?.language, preferences?.timezone);
  }, [isClient, preferences?.language, preferences?.timezone]);

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: Configurable application name + minimal mark */}
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-primary text-brand-primary-foreground">
            <Landmark className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="truncate font-display text-sm font-semibold tracking-tight text-ink sm:text-base">
            {APP_CONFIG.appName}
          </span>
        </Link>

        {/* Right: Greeting, subtle date, and Profile & Settings trigger */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-ink">{greetingText}</p>
            <p className="font-mono text-[11px] text-ink-muted tabular-nums">{currentDateText}</p>
          </div>

          <PrivacyModeToggle />

          <Link
            href="/profile"
            aria-label={t('nav.openProfile')}
            className={cn(
              'flex min-h-[40px] shrink-0 items-center gap-2.5 rounded-full border p-1 pr-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
              isProfileActive
                ? 'border-brand-accent bg-brand-accent-soft text-ink'
                : 'border-line bg-surface-muted/70 text-ink hover:bg-surface-muted'
            )}
          >
            <ProfileAvatar
              name={preferences?.profileName}
              avatarUrl={preferences?.profileAvatar}
              size="sm"
            />
            <span className="hidden whitespace-nowrap text-xs font-medium sm:inline">
              {preferences?.profileName?.trim() || t('nav.profile')}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
