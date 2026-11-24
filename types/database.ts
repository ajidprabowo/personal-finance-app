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

export const DATABASE_TABLES = [
  'appInstallation',
  'preferences',
  'accounts',
  'categories',
  'subcategories',
  'transactions',
  'budgets',
  'monthlyBudgetPlans',
  'budgetAlerts',
  'investmentPlatforms',
  'assetClasses',
  'holdings',
  'investmentActivities',
  'portfolioValuations',
  'emailConnections',
  'emailImportHistory',
] as const;

export type DatabaseTableName = (typeof DATABASE_TABLES)[number];

export interface DatabaseTableMap {
  appInstallation: AppInstallation;
  preferences: UserPreferences;
  accounts: Account;
  categories: Category;
  subcategories: Subcategory;
  transactions: Transaction;
  budgets: Budget;
  monthlyBudgetPlans: MonthlyBudgetPlan;
  budgetAlerts: BudgetAlert;
  investmentPlatforms: InvestmentPlatform;
  assetClasses: AssetClass;
  holdings: Holding;
  investmentActivities: InvestmentActivity;
  portfolioValuations: PortfolioValuation;
  emailConnections: EmailConnection;
  emailImportHistory: EmailImportHistory;
}

export interface TableSchemaMetadata {
  name: DatabaseTableName;
  category: 'system' | 'cashflow' | 'investment' | 'integration';
  primaryKey: string;
  indexes: string[];
  relationships: string[];
  supportsTestIsolation: boolean;
  description: string;
}

export interface MigrationRecord {
  version: number;
  name: string;
  description: string;
  backwardCompatible: boolean;
  tablesAffected: DatabaseTableName[];
}

export interface TableHealthStat {
  table: DatabaseTableName;
  category: TableSchemaMetadata['category'];
  totalCount: number;
  userCount: number;
  testCount: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  table: DatabaseTableName | 'database';
  recordId?: string;
  message: string;
}

export interface DatabaseValidationReport {
  valid: boolean;
  checkedAt: string;
  totalRecordsChecked: number;
  issues: ValidationIssue[];
}

export interface DatabaseHealthSummary {
  databaseName: string;
  schemaVersion: number;
  isOpen: boolean;
  installationId: string | null;
  baseCurrency: string;
  totalRecords: number;
  totalUserRecords: number;
  totalTestRecords: number;
  tables: TableHealthStat[];
  validation: DatabaseValidationReport;
}

export interface BackupEnvelope {
  app: string;
  formatVersion: string;
  schemaVersion: number;
  exportedAt: string;
  installationId: string;
  baseCurrency: string;
  recordCounts: Record<DatabaseTableName, number>;
  tables: {
    [K in DatabaseTableName]: DatabaseTableMap[K][];
  };
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  envelope?: BackupEnvelope;
  totalRecords: number;
  tableCounts: Partial<Record<DatabaseTableName, number>>;
}

export interface RestoreResult {
  restoredAt: string;
  totalRestoredRecords: number;
  preservedInstallationId: string;
  tableCounts: Record<DatabaseTableName, number>;
}
