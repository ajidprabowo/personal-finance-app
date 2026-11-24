'use client';

import React, { useState } from 'react';
import { CheckCircle2, GitBranch, Layers } from 'lucide-react';
import { useNotifications } from '@/hooks/use-notifications';
import { formatTimestamp } from '@/lib/dates';
import {
  getSchemaAndMigrationInfo,
  verifyDexieMigrationProbe,
  type MigrationVerificationResult,
} from '@/services/health.service';

export function SchemaMigrationsView() {
  const { notifySuccess, notifyError } = useNotifications();
  const { schemaVersion, catalog, migrations } = getSchemaAndMigrationInfo();
  const [probeResult, setProbeResult] = useState<MigrationVerificationResult | null>(null);
  const [running, setRunning] = useState(false);

  const handleVerifyMigration = async () => {
    setRunning(true);
    try {
      const result = await verifyDexieMigrationProbe();
      setProbeResult(result);
      if (result.passed) {
        notifySuccess('Migration check passed', result.notes);
      } else {
        notifyError('Migration check failed', result.notes);
      }
    } catch (error) {
      notifyError('Migration check error', error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Migration History */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <GitBranch className="h-4 w-4 text-slate-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Dexie.js Schema Versions & Migration History (Active: v{schemaVersion})
              </h2>
              <p className="text-xs text-slate-500">
                Backward-compatible versioned upgrades supporting Stage 2+ investment & cashflow extensions.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleVerifyMigration()}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>{running ? 'Running Probe...' : 'Run v1 -> v2 Probe'}</span>
          </button>
        </div>

        {probeResult ? (
          <div className="border-b border-slate-200 bg-emerald-50/50 px-5 py-3 text-xs text-slate-800">
            <div className="flex items-center gap-2 font-semibold text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <span>
                Probe Result: {probeResult.passed ? 'Passed' : 'Failed'} (v
                {probeResult.testedFromVersion} -&gt; v{probeResult.testedToVersion})
              </span>
            </div>
            <p className="mt-1 text-slate-700">{probeResult.notes}</p>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
              {formatTimestamp(probeResult.verifiedAt)}
            </p>
          </div>
        ) : null}

        <div className="divide-y divide-slate-100">
          {migrations.map((mig) => (
            <div key={mig.version} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  Version {mig.version}: {mig.name}
                </p>
                <span className="font-mono text-xs text-slate-500">
                  {mig.backwardCompatible ? 'Backward Compatible' : 'Breaking'} ·{' '}
                  {mig.tablesAffected.length} tables
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{mig.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 14-Table Schema Catalog */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
          <Layers className="h-4 w-4 text-slate-600" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              14-Table Schema & Extensibility Catalog
            </h2>
            <p className="text-xs text-slate-500">
              Prepared for Investment Pool, platform cash balances, asset holdings, linked transfers,
              partial buy/sell activities, historical valuations, and installation-scoped Gmail OAuth.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {catalog.map((table) => (
            <div key={table.name} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <code className="font-mono text-sm font-semibold text-slate-900">{table.name}</code>
                  <span className="text-xs capitalize text-slate-500">· {table.category}</span>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  {table.supportsTestIsolation ? 'Supports isTestData isolation' : 'System / Integration table'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{table.description}</p>
              <div className="mt-2.5 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <span className="font-medium text-slate-700">Indexes: </span>
                  <code className="font-mono text-[11px] text-slate-600">
                    {table.indexes.join(', ')}
                  </code>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Relationships: </span>
                  <span className="text-slate-600">{table.relationships.join('; ')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
