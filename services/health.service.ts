import Dexie from 'dexie';
import { ensureDatabaseOpen } from '@/database/client';
import {
  MIGRATION_HISTORY,
  upgradeV1ToV2,
  upgradeV2ToV3,
  upgradeV3ToV4,
  upgradeV4ToV5,
  upgradeV5ToV6,
  upgradeV6ToV7,
  upgradeV7ToV8,
} from '@/database/migrations';
import {
  SCHEMA_V1_STORES,
  SCHEMA_V2_STORES,
  SCHEMA_V3_STORES,
  SCHEMA_V4_STORES,
  SCHEMA_V5_STORES,
  SCHEMA_V6_STORES,
  SCHEMA_V7_STORES,
  SCHEMA_V8_STORES,
  TABLE_SCHEMA_CATALOG,
} from '@/database/schema';
import { validateDatabaseIntegrity } from '@/database/validator';
import { APP_CONFIG } from '@/lib/config';
import { nowIso } from '@/lib/dates';
import {
  appInstallationRepository,
  preferencesRepository,
  REPOSITORY_REGISTRY,
} from '@/repositories';
import { TestAwareRepository } from '@/repositories/base.repository';
import { DATABASE_TABLES, type DatabaseHealthSummary, type TableHealthStat } from '@/types/database';

export async function getDatabaseHealthSummary(): Promise<DatabaseHealthSummary> {
  const db = await ensureDatabaseOpen();
  const [installation, validation] = await Promise.all([
    appInstallationRepository.getSingleton(),
    validateDatabaseIntegrity(),
  ]);

  const preferences = installation
    ? await preferencesRepository.getByInstallationId(installation.installationId)
    : undefined;

  const catalogByName = new Map(TABLE_SCHEMA_CATALOG.map((meta) => [meta.name, meta]));

  const tableStats: TableHealthStat[] = await Promise.all(
    DATABASE_TABLES.map(async (tableName) => {
      const repo = REPOSITORY_REGISTRY[tableName];
      const meta = catalogByName.get(tableName);
      if (repo instanceof TestAwareRepository) {
        const counts = await repo.countByOrigin();
        return {
          table: tableName,
          category: meta?.category ?? 'system',
          totalCount: counts.totalCount,
          userCount: counts.userCount,
          testCount: counts.testCount,
        };
      }
      const totalCount = await repo.count();
      return {
        table: tableName,
        category: meta?.category ?? 'system',
        totalCount,
        userCount: totalCount,
        testCount: 0,
      };
    })
  );

  const totalRecords = tableStats.reduce((sum, item) => sum + item.totalCount, 0);
  const totalUserRecords = tableStats.reduce((sum, item) => sum + item.userCount, 0);
  const totalTestRecords = tableStats.reduce((sum, item) => sum + item.testCount, 0);

  return {
    databaseName: APP_CONFIG.databaseName,
    schemaVersion: db.verno,
    isOpen: db.isOpen(),
    installationId: installation?.installationId ?? null,
    baseCurrency: preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency,
    totalRecords,
    totalUserRecords,
    totalTestRecords,
    tables: tableStats,
    validation,
  };
}

export interface MigrationVerificationResult {
  passed: boolean;
  testedFromVersion: number;
  testedToVersion: number;
  migratedRecordOriginVerified: boolean;
  verifiedAt: string;
  notes: string;
}

/**
 * Runs a real, isolated Dexie v1 -> v2 schema migration verification inside an ephemeral probe DB
 * and cleans up the probe database immediately afterwards. Never touches user data.
 */
export async function verifyDexieMigrationProbe(): Promise<MigrationVerificationResult> {
  const probeDbName = `__pf_migration_probe_${Date.now()}`;
  const timestamp = nowIso();

  try {
    // Step 1: Open at v1 and write a legacy record without recordOrigin/isTestData
    const v1Db = new Dexie(probeDbName);
    v1Db.version(1).stores(SCHEMA_V1_STORES);
    await v1Db.open();
    await v1Db.table('appInstallation').add({
      id: 'probe_install',
      installationId: 'probe-uuid-0001',
      schemaVersion: 1,
      appLabel: APP_CONFIG.appName,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    });
    await v1Db.table('accounts').add({
      id: 'probe_acc_1',
      name: 'Legacy Probe Account',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 1000000,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await v1Db.table('budgets').add({
      id: 'probe_budget_1',
      categoryId: 'cat_default_food',
      period: 'monthly',
      year: 2026,
      month: 11,
      limitAmount: 1500000,
      currency: 'IDR',
      rolloverEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    v1Db.close();

    // Step 2: Reopen with current schema and run every migration hook.
    const currentDb = new Dexie(probeDbName);
    currentDb.version(1).stores(SCHEMA_V1_STORES);
    currentDb
      .version(2)
      .stores(SCHEMA_V2_STORES)
      .upgrade((tx) => upgradeV1ToV2(tx));
    currentDb
      .version(3)
      .stores(SCHEMA_V3_STORES)
      .upgrade((tx) => upgradeV2ToV3(tx));
    currentDb
      .version(4)
      .stores(SCHEMA_V4_STORES)
      .upgrade((tx) => upgradeV3ToV4(tx));
    currentDb
      .version(5)
      .stores(SCHEMA_V5_STORES)
      .upgrade((tx) => upgradeV4ToV5(tx));
    currentDb
      .version(6)
      .stores(SCHEMA_V6_STORES)
      .upgrade((tx) => upgradeV5ToV6(tx));
    currentDb
      .version(7)
      .stores(SCHEMA_V7_STORES)
      .upgrade((tx) => upgradeV6ToV7(tx));
    currentDb
      .version(8)
      .stores(SCHEMA_V8_STORES)
      .upgrade((tx) => upgradeV7ToV8(tx));
    await currentDb.open();

    const migratedAccount = (await currentDb.table('accounts').get('probe_acc_1')) as
      | Record<string, unknown>
      | undefined;
    const migratedBudget = (await currentDb.table('budgets').get('probe_budget_1')) as
      | Record<string, unknown>
      | undefined;
    const migratedInstall = (await currentDb.table('appInstallation').get('probe_install')) as
      | Record<string, unknown>
      | undefined;

    const passed =
      currentDb.verno === 8 &&
      migratedAccount?.recordOrigin === 'user' &&
      migratedAccount?.isTestData === false &&
      migratedBudget?.periodKey === '2026-11' &&
      migratedBudget?.isActive === true &&
      migratedBudget?.limitAmount === 1500000 &&
      migratedInstall?.schemaVersion === APP_CONFIG.currentSchemaVersion;

    currentDb.close();
    await Dexie.delete(probeDbName);

    return {
      passed,
      testedFromVersion: 1,
      testedToVersion: 8,
      migratedRecordOriginVerified: passed,
      verifiedAt: nowIso(),
      notes: passed
        ? 'Verified real Dexie v1 -> v2 -> v3 -> v4 -> v5 -> v6 -> v7 -> v8 upgrade hooks in isolated probe DB: indexes upgraded and legacy records preserved safely.'
        : 'Migration probe completed but migrated record attributes did not match expected v8 output.',
    };
  } catch (error) {
    await Dexie.delete(probeDbName).catch(() => undefined);
    return {
      passed: false,
      testedFromVersion: 1,
      testedToVersion: 2,
      migratedRecordOriginVerified: false,
      verifiedAt: nowIso(),
      notes: error instanceof Error ? error.message : 'Migration probe failed unexpectedly.',
    };
  }
}

export function getSchemaAndMigrationInfo() {
  return {
    schemaVersion: APP_CONFIG.currentSchemaVersion,
    catalog: TABLE_SCHEMA_CATALOG,
    migrations: MIGRATION_HISTORY,
  };
}
