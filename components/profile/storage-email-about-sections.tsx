'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Database,
  Download,
  HardDrive,
  Info,
  Mail,
  RefreshCw,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSection } from '@/components/ui/settings-section';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatDisplayDate, formatTimestamp } from '@/lib/dates';
import {
  exportDatabaseBackup,
  restoreDatabaseBackup,
  validateBackupJson,
} from '@/services/backup.service';
import {
  connectGmailAccount,
  disconnectGmailAccount,
  getGmailSessionSnapshot,
  type GmailSessionSnapshot,
} from '@/services/gmail-connection.service';
import {
  clearAllApplicationData,
  getStorageAndDiagnostics,
  type StorageDiagnosticsSnapshot,
} from '@/services/settings.service';
import type { BackupValidationResult } from '@/types/database';

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function EmailIntegrationSection() {
  const { preferences } = useBootstrap();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const [session, setSession] = useState<GmailSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;

  const refreshSession = useCallback(async () => {
    try {
      const snap = await getGmailSessionSnapshot();
      setSession(snap);
    } catch {
      // Keep previous snapshot on silent refresh error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectGmailAccount();
    } catch (error) {
      notifyError('Gmail connection failed', error);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const emailLabel = session?.connection?.emailAddress ?? 'your Gmail account';
    const approved = await confirm({
      title: 'Disconnect Gmail?',
      description: `Disconnect ${emailLabel} from transaction import? All previously imported financial transactions and your local ledger remain completely preserved in IndexedDB.`,
      confirmLabel: 'Disconnect Gmail',
      tone: 'default',
    });
    if (!approved) return;

    setDisconnecting(true);
    try {
      const next = await disconnectGmailAccount();
      setSession(next);
      notifySuccess(
        'Gmail disconnected',
        'OAuth session cleared. Previously imported transactions remain preserved.'
      );
    } catch (error) {
      notifyError('Failed to disconnect Gmail', error);
    } finally {
      setDisconnecting(false);
    }
  };

  const effectiveStatus = session?.effectiveStatus ?? 'disconnected';
  const connection = session?.connection ?? null;
  const isConnected = effectiveStatus === 'connected';
  const isExpired = effectiveStatus === 'token_expired';

  const statusBadge = loading
    ? 'Checking...'
    : isConnected
      ? 'Connected (Read-Only)'
      : isExpired
        ? 'Session Expired (Reconnect Required)'
        : 'Disconnected';

  const statusClass = isConnected
    ? 'border-status-success/30 bg-status-success/10 text-status-success'
    : isExpired
      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
      : 'border-line bg-surface-muted text-ink-muted';

  return (
    <SettingsSection
      id="email-integration"
      title={t('settings.section.email')}
      description="Connect Gmail using minimum read-only permissions to discover transaction emails for manual review and local import."
      action={
        connection && (isConnected || isExpired) ? (
          <Link href="/transactions/import">
            <Button variant="outline" size="sm">
              <span>Open Import Review</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </Link>
        ) : undefined
      }
    >
      <SettingsItem
        label="Connection Status"
        description="Scope requested: gmail.readonly. Refresh credentials are encrypted in a secure server session and never written to IndexedDB."
        control={
          <span className={`rounded border px-2.5 py-1 text-xs font-medium ${statusClass}`}>
            {statusBadge}
          </span>
        }
      />

      <SettingsItem
        label="Connected Email Address"
        description="Independent from your optional local profile email label."
        control={
          <span className="font-mono text-xs text-ink">
            {connection && effectiveStatus !== 'disconnected' && connection.emailAddress
              ? connection.emailAddress
              : '—'}
          </span>
        }
      />

      <SettingsItem
        label="Last Successful Sync"
        description="Timestamp of the most recent completed Gmail scan."
        control={
          <span className="font-mono text-xs tabular-nums text-ink-muted">
            {connection?.lastSyncedAt
              ? formatTimestamp(connection.lastSyncedAt, timezone)
              : 'Never synced'}
          </span>
        }
      />

      <SettingsItem
        label="Connection Controls"
        description="Every imported email requires your explicit review and approval before modifying your local ledger."
        control={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isConnected ? 'outline' : 'primary'}
              size="sm"
              loading={connecting}
              disabled={disconnecting}
              onClick={() => void handleConnect()}
            >
              {isExpired ? (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {isConnected
                  ? 'Switch / Reconnect Gmail'
                  : isExpired
                    ? 'Reconnect Gmail'
                    : 'Connect Gmail'}
              </span>
            </Button>
            {connection && effectiveStatus !== 'disconnected' ? (
              <Button
                variant="ghost"
                size="sm"
                loading={disconnecting}
                disabled={connecting}
                onClick={() => void handleDisconnect()}
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </Button>
            ) : null}
          </div>
        }
      />
    </SettingsSection>
  );
}

export function StorageBackupSection() {
  const { installation, preferences, refreshBootstrap } = useBootstrap();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError, notifyWarning } = useNotifications();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [diagnostics, setDiagnostics] = useState<StorageDiagnosticsSnapshot | null>(null);
  const [exporting, setExporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFilename, setPreviewFilename] = useState('');
  const [previewValidation, setPreviewValidation] = useState<BackupValidationResult | null>(null);

  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  const refreshDiagnostics = useCallback(async () => {
    try {
      const snap = await getStorageAndDiagnostics();
      setDiagnostics(snap);
    } catch {
      // Ignore silent refresh failure on mount
    }
  }, []);

  useEffect(() => {
    let active = true;
    getStorageAndDiagnostics()
      .then((snap) => {
        if (active) setDiagnostics(snap);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const handleExportBackup = async () => {
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

      await refreshBootstrap();
      await refreshDiagnostics();

      const total = Object.values(envelope.recordCounts).reduce((sum, n) => sum + n, 0);
      notifySuccess('Backup exported', `Downloaded ${filename} (${total} records).`);
    } catch (error) {
      notifyError('Backup export failed', error);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setValidating(true);
    try {
      const rawText = await file.text();
      const validation = validateBackupJson(rawText);

      if (!validation.valid || !validation.envelope) {
        setPreviewFilename(file.name);
        setPreviewValidation(validation);
        setPreviewOpen(true);
        notifyWarning(
          'Invalid backup file rejected',
          validation.errors[0] ?? 'The selected file failed structural validation.'
        );
        return;
      }

      setPreviewFilename(file.name);
      setPreviewValidation(validation);
      setPreviewOpen(true);
    } catch (error) {
      notifyError('Could not read backup file', error);
    } finally {
      setValidating(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmRestore = async () => {
    if (!previewValidation?.valid || !previewValidation.envelope) return;
    setRestoring(true);
    try {
      const result = await restoreDatabaseBackup(previewValidation.envelope);
      setPreviewOpen(false);
      setPreviewValidation(null);
      await refreshBootstrap();
      await refreshDiagnostics();
      notifySuccess(
        'Backup restored',
        `Restored ${result.totalRestoredRecords} records across ${Object.keys(result.tableCounts).length} tables.`
      );
    } catch (error) {
      notifyError('Backup restore failed', error);
    } finally {
      setRestoring(false);
    }
  };

  const handleClearApplicationData = async () => {
    const approved = await confirm({
      title: 'Clear All Application Data?',
      description:
        'This destructive action permanently deletes all local transactions, investments, accounts, custom categories, budgets, and preferences stored in this browser. Export a JSON backup first if you want to keep a copy.',
      confirmLabel: 'Permanently Clear Data',
      tone: 'danger',
      details: [
        `Database: ${APP_CONFIG.databaseName}`,
        `Total records: ${diagnostics?.health.totalRecords ?? 0}`,
        'Recommendation: Export a JSON backup before clearing.',
      ],
    });
    if (!approved) return;

    setClearing(true);
    try {
      await clearAllApplicationData();
      await refreshBootstrap();
      await refreshDiagnostics();
      notifySuccess(
        'Application data cleared',
        'Local database was wiped and cleanly re-initialized with factory defaults.'
      );
    } catch (error) {
      notifyError('Failed to clear application data', error);
    } finally {
      setClearing(false);
    }
  };

  const lastBackupValue = diagnostics?.lastBackupAt || preferences?.lastBackupAt || null;
  const counts = diagnostics?.userRecordCounts;

  return (
    <>
      <SettingsSection
        id="storage-backup"
        title={t('settings.section.storage')}
        description="Local storage diagnostics, full JSON export/restore with schema preview, and permanent workspace reset."
        action={
          <Link href="/console">
            <Button variant="ghost" size="sm">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Stage 1 DB Console</span>
            </Button>
          </Link>
        }
      >
        <SettingsItem
          label="Local Database Engine"
          description={`Database: ${APP_CONFIG.databaseName} · Schema v${diagnostics?.health.schemaVersion ?? APP_CONFIG.currentSchemaVersion}`}
          control={
            <div className="text-left sm:text-right">
              <p className="font-mono text-xs text-ink tabular-nums">
                {diagnostics
                  ? diagnostics.indexedDbAvailable
                    ? 'IndexedDB Available'
                    : 'IndexedDB Unavailable'
                  : 'Checking...'}
              </p>
              <p className="mt-0.5 max-w-[230px] truncate font-mono text-[11px] text-ink-muted">
                ID: {installation?.installationId ?? '—'}
              </p>
            </div>
          }
        />

        <SettingsItem
          label="Browser Storage Usage"
          description={
            diagnostics?.storageEstimate.available
              ? 'Estimated browser origin quota and usage reported by navigator.storage.estimate().'
              : 'Browser storage estimate unavailable in this runtime environment.'
          }
          control={
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink tabular-nums">
              <HardDrive className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
              <span>
                {diagnostics?.storageEstimate.available
                  ? `${formatBytes(diagnostics.storageEstimate.usageBytes)} / ${formatBytes(diagnostics.storageEstimate.quotaBytes)}`
                  : 'Estimate unavailable'}
              </span>
            </span>
          }
        />

        <SettingsItem
          label="Local Record Counts"
          description="Live counts of user-origin financial records stored on this device."
          layout="stack"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-surface-muted/60 px-3 py-2">
              <p className="text-[11px] text-ink-muted">Transactions</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
                {counts?.transactions ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted/60 px-3 py-2">
              <p className="text-[11px] text-ink-muted">Inv. Activities</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
                {counts?.investmentActivities ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted/60 px-3 py-2">
              <p className="text-[11px] text-ink-muted">Accounts</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
                {counts?.accounts ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface-muted/60 px-3 py-2">
              <p className="text-[11px] text-ink-muted">Budgets</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
                {counts?.budgets ?? '—'}
              </p>
            </div>
          </div>
        </SettingsItem>

        <SettingsItem
          label="Last Backup Date"
          description="Timestamp of your most recent JSON backup export from this browser."
          control={
            <span className="font-mono text-xs tabular-nums text-ink">
              {lastBackupValue ? formatDisplayDate(lastBackupValue, dateFormat) : 'Never backed up'}
            </span>
          }
        />

        <SettingsItem
          label={t('settings.backup.export')}
          description="Download a complete unencrypted JSON snapshot preserving all IDs, accounts, categories, transactions, investments, and budgets."
          control={
            <Button
              variant="outline"
              size="sm"
              loading={exporting}
              onClick={() => void handleExportBackup()}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export JSON</span>
            </Button>
          }
        />

        <SettingsItem
          label={t('settings.backup.import')}
          description="Validate a backup JSON file and preview record counts before overwriting local data."
          control={
            <div>
              <input
                ref={fileInputRef}
                id="settings-import-backup"
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImportFile(e)}
                className="hidden"
              />
              <label
                htmlFor="settings-import-backup"
                className="inline-flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{validating ? 'Validating...' : 'Import JSON'}</span>
              </label>
            </div>
          }
        />

        <SettingsItem
          label={t('settings.backup.clear')}
          description="Permanently wipe all local records and reset preferences to factory defaults. Export a backup first."
          control={
            <Button
              variant="danger"
              size="sm"
              loading={clearing}
              onClick={() => void handleClearApplicationData()}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear Data</span>
            </Button>
          }
        />
      </SettingsSection>

      <Modal
        open={previewOpen}
        onClose={() => {
          if (!restoring) {
            setPreviewOpen(false);
            setPreviewValidation(null);
          }
        }}
        title={previewValidation?.valid ? 'Backup Restore Preview' : 'Invalid Backup File'}
        description={
          previewValidation?.valid
            ? 'Review the validated backup metadata and record counts before overwriting your local database.'
            : 'This JSON file failed validation and cannot be restored.'
        }
      >
        {previewValidation ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-surface-muted/60 p-3 text-xs">
              <p className="font-medium text-ink">File: {previewFilename}</p>
              {previewValidation.envelope ? (
                <div className="mt-1 space-y-0.5 font-mono text-[11px] text-ink-muted tabular-nums">
                  <p>Schema Version: v{previewValidation.envelope.schemaVersion}</p>
                  <p>
                    Exported At: {formatDisplayDate(previewValidation.envelope.exportedAt, dateFormat)} (
                    {previewValidation.envelope.exportedAt})
                  </p>
                  <p>Total Records: {previewValidation.totalRecords}</p>
                </div>
              ) : null}
            </div>

            {previewValidation.errors.length > 0 ? (
              <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger">
                <p className="font-semibold">Validation Errors</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {previewValidation.errors.slice(0, 6).map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {previewValidation.warnings.length > 0 ? (
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning">
                <p className="font-semibold">Warnings</p>
                <ul className="mt-1 space-y-1">
                  {previewValidation.warnings.map((warn, idx) => (
                    <li key={idx}>{warn}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {previewValidation.valid ? (
              <>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-line">
                  <div className="divide-y divide-line text-xs">
                    {Object.entries(previewValidation.tableCounts).map(([table, count]) => (
                      <div key={table} className="flex items-center justify-between px-3 py-1.5">
                        <span className="font-mono text-ink-muted">{table}</span>
                        <span className="font-mono font-semibold tabular-nums text-ink">
                          {count ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Confirming restore will atomically replace all existing local tables with this backup.
                  </span>
                </div>
              </>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewValidation(null);
                }}
                disabled={restoring}
              >
                {previewValidation.valid ? t('common.cancel') : t('common.close')}
              </Button>
              {previewValidation.valid ? (
                <Button
                  variant="danger"
                  loading={restoring}
                  onClick={() => void handleConfirmRestore()}
                >
                  Overwrite & Restore
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

export function AboutAppSection() {
  const { t } = useI18n();

  return (
    <SettingsSection
      id="about"
      title={t('settings.section.about')}
      description="Application metadata, technology overview, and local-first storage architecture."
      action={<Info className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
    >
      <SettingsItem
        label="Application Name"
        control={<span className="text-sm font-medium text-ink">{APP_CONFIG.appName}</span>}
      />
      <SettingsItem
        label="Application Version"
        control={
          <span className="font-mono text-xs text-ink tabular-nums">
            v{APP_CONFIG.appVersion} (Schema v{APP_CONFIG.currentSchemaVersion})
          </span>
        }
      />
      <SettingsItem
        label="Architecture"
        control={<span className="text-xs font-medium text-ink">{APP_CONFIG.architectureLabel}</span>}
      />
      <SettingsItem
        label="Technology Overview"
        description="Next.js App Router, TypeScript, React, Tailwind CSS, Dexie.js (IndexedDB), Recharts, and Lucide Icons."
      />
      <SettingsItem
        label="Overview"
        description={APP_CONFIG.appDescription}
      />
      <SettingsItem
        label="Data Storage Summary"
        description="Your accounts, transactions, investments, analytics, and budgets reside locally on this device without cloud financial syncing or login."
      />
    </SettingsSection>
  );
}

export function StorageEmailAboutSections() {
  return (
    <div className="space-y-8">
      <EmailIntegrationSection />
      <StorageBackupSection />
      <AboutAppSection />
    </div>
  );
}
