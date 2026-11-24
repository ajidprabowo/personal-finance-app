'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  FlaskConical,
  GitBranch,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useNotifications } from '@/hooks/use-notifications';
import { formatCurrency } from '@/lib/currency';
import { formatTimestamp } from '@/lib/dates';
import {
  getDatabaseHealthSummary,
  verifyDexieMigrationProbe,
  type MigrationVerificationResult,
} from '@/services/health.service';
import type { DatabaseHealthSummary } from '@/types/database';

export function OverviewHealthView() {
  const { installation, preferences, isFirstLaunch } = useBootstrap();
  const { notifySuccess, notifyError, notifyWarning } = useNotifications();
  const [health, setHealth] = useState<DatabaseHealthSummary | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [migrationProbe, setMigrationProbe] = useState<MigrationVerificationResult | null>(null);
  const [runningProbe, setRunningProbe] = useState(false);

  const loadHealth = useCallback(async (announce = false) => {
    setLoadingHealth(true);
    try {
      const summary = await getDatabaseHealthSummary();
      setHealth(summary);
      if (announce) {
        if (summary.validation.valid) {
          notifySuccess(
            'Integrity check passed',
            `Verified ${summary.validation.totalRecordsChecked} records across ${summary.tables.length} IndexedDB tables.`
          );
        } else {
          notifyWarning(
            'Integrity issues detected',
            `${summary.validation.issues.length} issue(s) reported by database validator.`
          );
        }
      }
    } catch (error) {
      notifyError('Failed to inspect local database', error);
    } finally {
      setLoadingHealth(false);
    }
  }, [notifyError, notifySuccess, notifyWarning]);

  useEffect(() => {
    let active = true;
    getDatabaseHealthSummary()
      .then((summary) => {
        if (!active) return;
        setHealth(summary);
      })
      .catch((error) => {
        if (!active) return;
        notifyError('Failed to inspect local database', error);
      })
      .finally(() => {
        if (active) setLoadingHealth(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const handleCopyInstallationId = async () => {
    if (!installation?.installationId) return;
    try {
      await navigator.clipboard.writeText(installation.installationId);
      notifySuccess('Installation ID copied', installation.installationId);
    } catch {
      notifyError('Clipboard unavailable', 'Copy the installation ID directly from the field.');
    }
  };

  const handleRunMigrationProbe = async () => {
    setRunningProbe(true);
    try {
      const result = await verifyDexieMigrationProbe();
      setMigrationProbe(result);
      if (result.passed) {
        notifySuccess('Migration probe passed', result.notes);
      } else {
        notifyError('Migration probe failed', result.notes);
      }
    } catch (error) {
      notifyError('Migration probe error', error);
    } finally {
      setRunningProbe(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Summary Strip */}
      <section className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Local-First IndexedDB Vault · Stage 1 Foundation
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Database Health & Installation Identity
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">
            All financial records are stored locally on this device with Dexie.js. No cloud
            database, login, or external sync is active.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadHealth(true)}
            disabled={loadingHealth}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
            <span>Run Integrity Check</span>
          </button>
          <button
            type="button"
            onClick={() => void handleRunMigrationProbe()}
            disabled={runningProbe}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>{runningProbe ? 'Testing Migration...' : 'Verify v1 -> v2 Migration'}</span>
          </button>
        </div>
      </section>

      {/* Primary KPI Grid */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Database Engine</p>
          <div className="mt-2 flex items-center gap-2">
            {health?.isOpen ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            )}
            <span className="text-base font-semibold text-slate-900">
              {health?.isOpen ? 'Connected' : 'Checking'}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-xs text-slate-500 tabular-nums">
            Dexie v{health?.schemaVersion ?? '—'} · 14 tables
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Stored Records</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {health ? health.totalRecords : '—'}
          </p>
          <p className="mt-1.5 font-mono text-xs text-slate-500 tabular-nums">
            {health ? `${health.totalUserRecords} system/user · ${health.totalTestRecords} test` : 'Loading counts...'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Default Currency</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {preferences?.baseCurrency ?? 'IDR'}
          </p>
          <p className="mt-1.5 font-mono text-xs text-slate-500 tabular-nums">
            Sample: {formatCurrency(1250000, preferences?.baseCurrency ?? 'IDR', preferences?.locale ?? 'id-ID')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Integrity Status</p>
          <div className="mt-2 flex items-center gap-2">
            {health?.validation.valid ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="text-base font-semibold text-slate-900">Valid</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <span className="text-base font-semibold text-red-700">
                  {health ? `${health.validation.issues.length} Issue(s)` : 'Checking'}
                </span>
              </>
            )}
          </div>
          <p className="mt-1.5 font-mono text-xs text-slate-500 tabular-nums">
            Checked: {health ? formatTimestamp(health.validation.checkedAt) : '—'}
          </p>
        </div>
      </section>

      {/* Migration Probe Result Banner (when triggered) */}
      {migrationProbe ? (
        <section
          className={`rounded-lg border p-4 ${
            migrationProbe.passed
              ? 'border-emerald-200 bg-emerald-50/60'
              : 'border-red-200 bg-red-50/60'
          }`}
        >
          <div className="flex items-start gap-3">
            {migrationProbe.passed ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Migration Verification ({migrationProbe.testedFromVersion} -&gt;{' '}
                {migrationProbe.testedToVersion}): {migrationProbe.passed ? 'Passed' : 'Failed'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">{migrationProbe.notes}</p>
              <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                Verified at {formatTimestamp(migrationProbe.verifiedAt)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Installation Identity Panel */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Persistent Installation Identity
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Generated once on first launch and preserved across browser refreshes for future
              server-side Gmail OAuth association.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-600">
            {isFirstLaunch ? 'Initialized this session' : 'Loaded from IndexedDB'}
          </span>
        </div>

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <p className="text-xs text-slate-500">Installation ID</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="truncate rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900">
                {installation?.installationId ?? '—'}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyInstallationId()}
                aria-label="Copy installation ID"
                className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500">First Initialized</p>
            <p className="mt-1.5 font-mono text-xs text-slate-800 tabular-nums">
              {formatTimestamp(installation?.createdAt)}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Last Opened</p>
            <p className="mt-1.5 font-mono text-xs text-slate-800 tabular-nums">
              {formatTimestamp(installation?.lastOpenedAt)}
            </p>
          </div>
        </div>
      </section>

      {/* 14-Table Breakdown */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <Database className="h-4 w-4 text-slate-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                14-Table IndexedDB Inventory
              </h3>
              <p className="text-xs text-slate-500">
                Real user/system records remain strictly isolated from Stage 1 verification test data.
              </p>
            </div>
          </div>
          <Link
            href="/crud"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span>Open CRUD Workbench</span>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="px-5 py-2.5">Table</th>
                <th className="px-4 py-2.5">Domain</th>
                <th className="px-4 py-2.5 text-right">User / System</th>
                <th className="px-4 py-2.5 text-right">Test Data</th>
                <th className="px-5 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(health?.tables ?? []).map((row) => (
                <tr key={row.table} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-2.5 font-mono text-xs font-medium text-slate-900">
                    {row.table}
                  </td>
                  <td className="px-4 py-2.5 text-xs capitalize text-slate-600">{row.category}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-800 tabular-nums">
                    {row.userCount}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                    {row.testCount > 0 ? (
                      <span className="inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                        {row.testCount}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    {row.totalCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
