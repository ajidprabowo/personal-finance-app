import Dexie, { type Table } from 'dexie';
import { APP_CONFIG } from '@/lib/config';
import { AppError } from '@/lib/errors';
import {
  upgradeV1ToV2,
  upgradeV2ToV3,
  upgradeV3ToV4,
  upgradeV4ToV5,
  upgradeV5ToV6,
  upgradeV6ToV7,
} from '@/database/migrations';
import {
  SCHEMA_V1_STORES,
  SCHEMA_V2_STORES,
  SCHEMA_V3_STORES,
  SCHEMA_V4_STORES,
  SCHEMA_V5_STORES,
  SCHEMA_V6_STORES,
  SCHEMA_V7_STORES,
} from '@/database/schema';
import type {
  Account,
  AppInstallation,
  AssetClass,
  Budget,
  BudgetAlert,
  Category,
  EmailConnection,
  EmailImportHistory,
  Holding,
  InvestmentActivity,
  InvestmentPlatform,
  MonthlyBudgetPlan,
  PortfolioValuation,
  Subcategory,
  Transaction,
  UserPreferences,
} from '@/types/entities';
import { DATABASE_TABLES, type DatabaseTableName } from '@/types/database';

export class PersonalFinanceDB extends Dexie {
  appInstallation!: Table<AppInstallation, string>;
  preferences!: Table<UserPreferences, string>;
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  subcategories!: Table<Subcategory, string>;
  transactions!: Table<Transaction, string>;
  budgets!: Table<Budget, string>;
  monthlyBudgetPlans!: Table<MonthlyBudgetPlan, string>;
  budgetAlerts!: Table<BudgetAlert, string>;
  investmentPlatforms!: Table<InvestmentPlatform, string>;
  assetClasses!: Table<AssetClass, string>;
  holdings!: Table<Holding, string>;
  investmentActivities!: Table<InvestmentActivity, string>;
  portfolioValuations!: Table<PortfolioValuation, string>;
  emailConnections!: Table<EmailConnection, string>;
  emailImportHistory!: Table<EmailImportHistory, string>;

  constructor(databaseName: string = APP_CONFIG.databaseName) {
    super(databaseName);

    this.version(1).stores(SCHEMA_V1_STORES);

    this.version(2)
      .stores(SCHEMA_V2_STORES)
      .upgrade((tx) => upgradeV1ToV2(tx));

    this.version(3)
      .stores(SCHEMA_V3_STORES)
      .upgrade((tx) => upgradeV2ToV3(tx));

    this.version(4)
      .stores(SCHEMA_V4_STORES)
      .upgrade((tx) => upgradeV3ToV4(tx));

    this.version(5)
      .stores(SCHEMA_V5_STORES)
      .upgrade((tx) => upgradeV4ToV5(tx));

    this.version(6)
      .stores(SCHEMA_V6_STORES)
      .upgrade((tx) => upgradeV5ToV6(tx));

    this.version(7)
      .stores(SCHEMA_V7_STORES)
      .upgrade((tx) => upgradeV6ToV7(tx));
  }

  public getTypedTable(name: DatabaseTableName): Table<unknown, string> {
    return this.table(name);
  }
}

let dbInstance: PersonalFinanceDB | null = null;

export function assertBrowserIndexedDBAvailable(): void {
  if (typeof globalThis.indexedDB === 'undefined') {
    throw new AppError(
      'IndexedDB is unavailable in this environment. Local-first storage requires IndexedDB.',
      'DATABASE_INIT_ERROR'
    );
  }
}

export function getDatabase(): PersonalFinanceDB {
  assertBrowserIndexedDBAvailable();
  if (!dbInstance) {
    dbInstance = new PersonalFinanceDB(APP_CONFIG.databaseName);
  }
  return dbInstance;
}

export function resetDatabaseInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export async function ensureDatabaseOpen(): Promise<PersonalFinanceDB> {
  const db = getDatabase();
  if (!db.isOpen()) {
    try {
      await db.open();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown IndexedDB open failure';
      throw new AppError(`Failed to open local IndexedDB database: ${reason}`, 'DATABASE_INIT_ERROR');
    }
  }
  return db;
}

export async function verifyDatabaseConnection(): Promise<{
  connected: boolean;
  schemaVersion: number;
  tableCount: number;
}> {
  const db = await ensureDatabaseOpen();
  const tableNames = db.tables.map((t) => t.name);
  const missingTables = DATABASE_TABLES.filter((name) => !tableNames.includes(name));
  if (missingTables.length > 0) {
    throw new AppError(
      `Database schema mismatch. Missing tables: ${missingTables.join(', ')}`,
      'DATABASE_INIT_ERROR'
    );
  }

  return {
    connected: db.isOpen(),
    schemaVersion: db.verno,
    tableCount: db.tables.length,
  };
}
