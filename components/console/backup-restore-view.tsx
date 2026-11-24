'use client';

import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useNotifications } from '@/hooks/use-notifications';
import { formatTimestamp } from '@/lib/dates';
import {
  exportDatabaseBackup,
  restoreDatabaseBackup,
  validateBackupJson,
} from '@/services/backup.service';
import { DATABASE_TABLES, type BackupValidationResult, type RestoreResult } from '@/types/database';

export function BackupRestoreView() {
  const { refreshBootstrap } = useBootstrap();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError, notifyWarning } = useNotifications();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null);
  const [lastRestore, setLastRestore] = useState<RestoreResult | null>(null);

  const handleExport = async () => {
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
      notifySuccess('JSON backup exported', `${filename} (${total} records across 14 tables).`);
    } catch (error) {
      notifyError('Export failed', error);
    } finally {
      setExporting(false);
    }
  };

  const inspectRawPayload = (filename: string, rawText: string) => {
    setSelectedFilename(filename);
    setLastRestore(null);
    const result = validateBackupJson(rawText);
    setValidationResult(result);

    if (result.valid) {
      notifySuccess(
        'Backup file validated',
        `${result.totalRecords} record(s) ready for confirmation.`
      );
    } else {
      notifyWarning(
        'Invalid backup rejected',
        `Rejected "${filename}" with ${result.errors.length} validation error(s). Existing data is untouched.`
      );
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      inspectRawPayload(file.name, text);
    } catch (error) {
      notifyError('Unable to read file', error);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleTestMalformedFile = () => {
    const malformedSample = JSON.stringify(
      {
        app: 'unknown-external-app',
        schemaVersion: 999,
        tables: {
          accounts: [{ name: 'Missing ID field' }],
        },
      },
      null,
      2
    );
    inspectRawPayload('invalid-sample-test.json', malformedSample);
  };

  const handleExecuteRestore = async () => {
    if (!validationResult?.valid || !validationResult.envelope) return;

    const approved = await confirm({
      title: 'Confirm Backup Restore & Overwrite',
      description:
        'Restoring this backup will replace all current records across all 14 IndexedDB tables with the validated snapshot.',
      confirmLabel: 'Overwrite & Restore Backup',
      tone: 'danger',
      details: [
        `Source File: ${selectedFilename ?? 'Uploaded JSON'}`,
        `Total Records to Restore: ${validationResult.totalRecords}`,
        `Backup Schema Version: v${validationResult.envelope.schemaVersion}`,
        `Installation ID in Backup: ${validationResult.envelope.installationId}`,
      ],
    });

    if (!approved) return;

    setRestoring(true);
    try {
      const result = await restoreDatabaseBackup(validationResult.envelope);
      setLastRestore(result);
      await refreshBootstrap();
      notifySuccess(
        'Database restored atomically',
        `Restored ${result.totalRestoredRecords} record(s) preserving IDs and relationships.`
      );
    } catch (error) {
      notifyError('Restore failed', error);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Card */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Export JSON Database Backup</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
              Exports all 14 IndexedDB tables inside a read transaction, preserving record IDs,
              timestamps, installation identity, and foreign-key relationships.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{exporting ? 'Exporting JSON...' : 'Download JSON Backup'}</span>
          </button>
        </div>
      </section>

      {/* Import & Validation Card */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Validate & Restore JSON Backup
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Uploaded files are structurally and relationally validated before any write occurs.
              Invalid or incompatible files are safely rejected without altering existing records.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestMalformedFile}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span>Test Invalid File Rejection</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
              id="backup-file-input"
            />
            <label
              htmlFor="backup-file-input"
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Select JSON File</span>
            </label>
          </div>
        </div>

        {/* Validation Result Display */}
        {!validationResult ? (
          <div className="py-10 text-center">
            <FileJson className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-700">No backup file selected</p>
            <p className="mt-1 text-xs text-slate-500">
              Export a JSON backup above, then upload it here (or test invalid file rejection).
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div
              className={`rounded-md border p-4 ${
                validationResult.valid
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : 'border-red-200 bg-red-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {validationResult.valid ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {validationResult.valid
                        ? `Validation Passed: ${selectedFilename}`
                        : `Validation Rejected: ${selectedFilename}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-700">
                      {validationResult.valid
                        ? `${validationResult.totalRecords} total record(s) verified across all 14 tables.`
                        : 'Local database was NOT modified. Review the validation errors below.'}
                    </p>
                  </div>
                </div>

                {validationResult.valid ? (
                  <button
                    type="button"
                    onClick={() => void handleExecuteRestore()}
                    disabled={restoring}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-red-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>{restoring ? 'Restoring...' : 'Restore Backup'}</span>
                  </button>
                ) : null}
              </div>

              {validationResult.errors.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-red-800">
                  {validationResult.errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              ) : null}

              {validationResult.warnings.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
                  {validationResult.warnings.map((warn, idx) => (
                    <li key={idx}>{warn}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            {validationResult.valid && validationResult.envelope ? (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-600">
                      <th className="px-4 py-2">Table</th>
                      <th className="px-4 py-2 text-right">Records in Backup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {DATABASE_TABLES.map((tableName) => (
                      <tr key={tableName}>
                        <td className="px-4 py-1.5 font-mono text-slate-800">{tableName}</td>
                        <td className="px-4 py-1.5 text-right font-mono text-slate-900 tabular-nums">
                          {validationResult.tableCounts[tableName] ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}

        {lastRestore ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/50 p-4 text-xs text-slate-800">
            <p className="font-semibold text-emerald-900">Restore Completed</p>
            <p className="mt-1">
              Restored {lastRestore.totalRestoredRecords} record(s) at{' '}
              <span className="font-mono tabular-nums">{formatTimestamp(lastRestore.restoredAt)}</span>.
              Preserved Installation ID:{' '}
              <span className="font-mono">{lastRestore.preservedInstallationId}</span>
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
