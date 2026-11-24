import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { nowIso, todayDateString } from '@/lib/dates';
import { BackupError } from '@/lib/errors';
import {
  DATABASE_TABLES,
  type BackupEnvelope,
  type BackupValidationResult,
  type DatabaseTableMap,
  type DatabaseTableName,
  type RestoreResult,
} from '@/types/database';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function exportDatabaseBackup(): Promise<{
  envelope: BackupEnvelope;
  jsonString: string;
  filename: string;
}> {
  const db = await ensureDatabaseOpen();

  const tablesData = {} as { [K in DatabaseTableName]: DatabaseTableMap[K][] };
  const recordCounts = {} as Record<DatabaseTableName, number>;

  await db.transaction('r', db.tables, async () => {
    for (const tableName of DATABASE_TABLES) {
      const rows = (await db.table(tableName).toArray()) as DatabaseTableMap[typeof tableName][];
      tablesData[tableName] = rows as never;
      recordCounts[tableName] = rows.length;
    }
  });

  const exportedAt = nowIso();
  const installation = tablesData.appInstallation[0];
  const preferences = tablesData.preferences[0];

  if (preferences) {
    await db.preferences.update(preferences.id, {
      lastBackupAt: exportedAt,
    });
    tablesData.preferences = tablesData.preferences.map((p) =>
      p.id === preferences.id ? { ...p, lastBackupAt: exportedAt } : p
    );
  }

  const envelope: BackupEnvelope = {
    app: APP_CONFIG.backupAppIdentifier,
    formatVersion: APP_CONFIG.backupFormatVersion,
    schemaVersion: db.verno,
    exportedAt,
    installationId: installation?.installationId ?? 'unknown',
    baseCurrency: preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency,
    recordCounts,
    tables: tablesData,
  };

  return {
    envelope,
    jsonString: JSON.stringify(envelope, null, 2),
    filename: `personal-finance-backup-${todayDateString(preferences?.timezone)}.json`,
  };
}

export function validateBackupJson(rawText: string): BackupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tableCounts: Partial<Record<DatabaseTableName, number>> = {};

  if (!rawText || !rawText.trim()) {
    return {
      valid: false,
      errors: ['The selected file is empty.'],
      warnings: [],
      totalRecords: 0,
      tableCounts,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      errors: ['Invalid JSON syntax. Please choose a valid JSON backup file exported by this app.'],
      warnings: [],
      totalRecords: 0,
      tableCounts,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      valid: false,
      errors: ['Backup root must be a JSON object.'],
      warnings: [],
      totalRecords: 0,
      tableCounts,
    };
  }

  if (parsed.app !== APP_CONFIG.backupAppIdentifier) {
    errors.push(
      `Incompatible backup identifier "${String(parsed.app ?? 'missing')}". Expected "${APP_CONFIG.backupAppIdentifier}".`
    );
  }

  if (typeof parsed.formatVersion !== 'string' || !parsed.formatVersion) {
    errors.push('Missing or invalid backup formatVersion.');
  }

  if (
    typeof parsed.schemaVersion !== 'number' ||
    !Number.isInteger(parsed.schemaVersion) ||
    parsed.schemaVersion < 1
  ) {
    errors.push('Missing or invalid schemaVersion.');
  } else if (parsed.schemaVersion > APP_CONFIG.currentSchemaVersion) {
    errors.push(
      `Backup schemaVersion (${parsed.schemaVersion}) is newer than this app supports (${APP_CONFIG.currentSchemaVersion}).`
    );
  }

  if (!isPlainObject(parsed.tables)) {
    errors.push('Missing "tables" object in backup envelope.');
    return {
      valid: false,
      errors,
      warnings,
      totalRecords: 0,
      tableCounts,
    };
  }

  const tablesObj = parsed.tables;
  let totalRecords = 0;

  const backupSchemaVersion =
    typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : APP_CONFIG.currentSchemaVersion;
  const v6OptionalTables = new Set<DatabaseTableName>(['monthlyBudgetPlans', 'budgetAlerts']);

  for (const tableName of DATABASE_TABLES) {
    const rawRows = tablesObj[tableName];
    let rows: unknown[];
    if (!Array.isArray(rawRows)) {
      if (backupSchemaVersion < 6 && v6OptionalTables.has(tableName)) {
        rows = [];
        tablesObj[tableName] = rows;
      } else {
        errors.push(`Missing or invalid array for table "${tableName}".`);
        continue;
      }
    } else {
      rows = rawRows;
    }

    tableCounts[tableName] = rows.length;
    totalRecords += rows.length;

    const seenIds = new Set<string>();
    rows.forEach((row: unknown, index: number) => {
      if (!isPlainObject(row)) {
        errors.push(`Table "${tableName}" row #${index + 1} is not a valid object.`);
        return;
      }
      if (typeof row.id !== 'string' || !row.id.trim()) {
        errors.push(`Table "${tableName}" row #${index + 1} is missing a valid string "id".`);
        return;
      }
      if (seenIds.has(row.id)) {
        errors.push(`Table "${tableName}" contains duplicate id "${row.id}".`);
      }
      seenIds.add(row.id);
    });
  }

  // Validate installation presence
  const installations = Array.isArray(tablesObj.appInstallation) ? tablesObj.appInstallation : [];
  if (installations.length === 0) {
    errors.push('Backup must contain an appInstallation record with a valid installationId.');
  } else {
    const firstInstall = installations[0];
    if (
      !isPlainObject(firstInstall) ||
      typeof firstInstall.installationId !== 'string' ||
      !firstInstall.installationId.trim()
    ) {
      errors.push('appInstallation record is missing a valid installationId.');
    }
  }

  // Validate key foreign-key relationships if no structural errors so far
  if (errors.length === 0) {
    const accountIds = new Set(
      (tablesObj.accounts as Record<string, unknown>[]).map((r) => String(r.id))
    );
    const categoryIds = new Set(
      (tablesObj.categories as Record<string, unknown>[]).map((r) => String(r.id))
    );
    const platformIds = new Set(
      (tablesObj.investmentPlatforms as Record<string, unknown>[]).map((r) => String(r.id))
    );
    const assetClassIds = new Set(
      (tablesObj.assetClasses as Record<string, unknown>[]).map((r) => String(r.id))
    );

    for (const sub of tablesObj.subcategories as Record<string, unknown>[]) {
      if (typeof sub.categoryId !== 'string' || !categoryIds.has(sub.categoryId)) {
        errors.push(`Subcategory "${String(sub.id)}" references missing categoryId "${String(sub.categoryId)}".`);
      }
    }

    for (const tx of tablesObj.transactions as Record<string, unknown>[]) {
      if (typeof tx.accountId !== 'string' || !accountIds.has(tx.accountId)) {
        errors.push(`Transaction "${String(tx.id)}" references missing accountId "${String(tx.accountId)}".`);
      }
      if (tx.toAccountId !== undefined && tx.toAccountId !== null && !accountIds.has(String(tx.toAccountId))) {
        errors.push(`Transfer transaction "${String(tx.id)}" references missing toAccountId "${String(tx.toAccountId)}".`);
      }
    }

    for (const holding of tablesObj.holdings as Record<string, unknown>[]) {
      if (typeof holding.platformId !== 'string' || !platformIds.has(holding.platformId)) {
        errors.push(`Holding "${String(holding.id)}" references missing platformId "${String(holding.platformId)}".`);
      }
      if (typeof holding.assetClassId !== 'string' || !assetClassIds.has(holding.assetClassId)) {
        errors.push(`Holding "${String(holding.id)}" references missing assetClassId "${String(holding.assetClassId)}".`);
      }
    }

    const totalTestRecords = DATABASE_TABLES.reduce((sum, tableName) => {
      const rows = tablesObj[tableName] as Record<string, unknown>[];
      return sum + rows.filter((r) => r.isTestData === true || r.recordOrigin === 'test').length;
    }, 0);

    if (totalTestRecords > 0) {
      warnings.push(
        `This backup includes ${totalTestRecords} Stage 1 verification test record(s) tagged with isTestData.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    envelope: errors.length === 0 ? (parsed as unknown as BackupEnvelope) : undefined,
    totalRecords,
    tableCounts,
  };
}

export async function restoreDatabaseBackup(envelope: BackupEnvelope): Promise<RestoreResult> {
  const db = await ensureDatabaseOpen();

  // Re-validate defensively before executing destructive overwrite
  const revalidation = validateBackupJson(JSON.stringify(envelope));
  if (!revalidation.valid || !revalidation.envelope) {
    throw new BackupError('Backup validation failed before restore.', revalidation.errors);
  }

  const validEnvelope = revalidation.envelope;
  const tableCounts = {} as Record<DatabaseTableName, number>;
  let totalRestoredRecords = 0;

  await db.transaction('rw', db.tables, async () => {
    for (const tableName of DATABASE_TABLES) {
      const table = db.table(tableName);
      await table.clear();
      const rows = validEnvelope.tables[tableName] ?? [];
      if (rows.length > 0) {
        await table.bulkAdd(rows as never[]);
      }
      tableCounts[tableName] = rows.length;
      totalRestoredRecords += rows.length;
    }
  });

  const restoredInstallation = validEnvelope.tables.appInstallation[0];

  return {
    restoredAt: nowIso(),
    totalRestoredRecords,
    preservedInstallationId: restoredInstallation?.installationId ?? validEnvelope.installationId,
    tableCounts,
  };
}
