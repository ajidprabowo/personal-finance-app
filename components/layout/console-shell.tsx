'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ArchiveRestore,
  Database,
  Download,
  FlaskConical,
  Layers,
  Menu,
  X,
} from 'lucide-react';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { exportDatabaseBackup } from '@/services/backup.service';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CONSOLE_NAV_ITEMS: NavItem[] = [
  { href: '/console', label: 'Overview & Health', icon: Activity },
  { href: '/crud', label: 'CRUD Verification', icon: FlaskConical },
  { href: '/backup', label: 'Backup & Restore', icon: ArchiveRestore },
  { href: '/schema', label: 'Schema & Migrations', icon: Layers },
];

export function ConsoleShell({
  sectionTitle,
  children,
}: {
  sectionTitle: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { status, installation, preferences } = useBootstrap();
  const { notifySuccess, notifyError } = useNotifications();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleQuickExport = async () => {
    setExporting(true);
    try {
      const { jsonString, filename, envelope } = await exportDatabaseBackup();
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const total = Object.values(envelope.recordCounts).reduce((sum, n) => sum + n, 0);
      notifySuccess('Backup exported', `Saved ${filename} (${total} records across 14 tables).`);
    } catch (error) {
      notifyError('Backup export failed', error);
    } finally {
      setExporting(false);
    }
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between bg-white">
      <div>
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-800">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{APP_CONFIG.appName}</p>
              <p className="truncate text-xs text-slate-500">Internal Console · Stage 1</p>
            </div>
          </div>
        </div>

        <div className="px-3 py-4">
          <p className="px-2.5 pb-2 text-xs font-medium text-slate-500">Verification Modules</p>
          <nav className="space-y-1" aria-label="Stage 1 Verification Console">
            {CONSOLE_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mx-3 border-t border-slate-200 pt-4">
          <div className="px-2.5">
            <p className="text-xs font-medium text-slate-500">Application Workspace</p>
            <div className="mt-2 flex flex-col gap-1.5">
              <Link
                href="/dashboard"
                className="text-xs font-medium text-slate-800 underline underline-offset-4 hover:text-slate-950"
              >
                Open Dashboard
              </Link>
              <Link
                href="/profile"
                className="text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
              >
                Open Profile &amp; Settings
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 px-5 py-3.5 text-xs text-slate-500">
        <div className="flex items-center justify-between gap-2">
          <span>Storage</span>
          <span className="font-mono text-slate-700">IndexedDB (Local)</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span>Base Currency</span>
          <span className="font-mono text-slate-700">
            {preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 w-64 border-r border-slate-200 bg-white shadow-lg">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-3.5 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
            {renderSidebarContent()}
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden truncate text-slate-500 sm:inline">
                {APP_CONFIG.consoleTitle}
              </span>
              <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="truncate font-semibold text-slate-900">{sectionTitle}</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => void handleQuickExport()}
              disabled={status !== 'ready' || exporting}
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exporting ? 'Exporting...' : 'Export Backup'}</span>
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {status === 'loading' ? (
            <div className="space-y-6" aria-busy="true" aria-label="Initializing local database">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((slot) => (
                  <div
                    key={slot}
                    className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
                  />
                ))}
              </div>
              <div className="h-80 animate-pulse rounded-lg border border-slate-200 bg-white" />
            </div>
          ) : (
            <div key={installation?.installationId ?? 'ready'}>{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}
