'use client';

import React from 'react';
import { AppHeader } from '@/components/layout/app-header';
import { BottomNavigation } from '@/components/layout/bottom-navigation';
import { useBootstrap } from '@/hooks/use-bootstrap';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useBootstrap();

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <AppHeader />
      <main className="flex-1 pb-24 sm:pb-28">
        {status === 'loading' ? (
          <div
            className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8"
            aria-busy="true"
            aria-label="Loading local workspace"
          >
            <div className="h-16 animate-pulse rounded-xl border border-line bg-surface" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="h-32 animate-pulse rounded-xl border border-line bg-surface" />
              <div className="h-32 animate-pulse rounded-xl border border-line bg-surface" />
            </div>
            <div className="h-48 animate-pulse rounded-xl border border-line bg-surface" />
          </div>
        ) : (
          children
        )}
      </main>
      <BottomNavigation />
    </div>
  );
}
