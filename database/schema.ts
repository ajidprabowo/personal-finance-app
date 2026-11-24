import type { DatabaseTableName, TableSchemaMetadata } from '@/types/database';

/**
 * Version 1: Initial 14-table local-first schema.
 */
export const SCHEMA_V1_STORES: Record<string, string> = {
  appInstallation: '&id, &installationId, createdAt',
  preferences: '&id, installationId, baseCurrency, updatedAt',
  accounts: '&id, type, currency, recordOrigin, createdAt',
  categories: '&id, kind, sortOrder, recordOrigin, createdAt',
  subcategories: '&id, categoryId, sortOrder, recordOrigin, createdAt',
  transactions: '&id, accountId, toAccountId, categoryId, subcategoryId, type, date, status, recordOrigin, createdAt',
  budgets: '&id, categoryId, subcategoryId, period, year, month, recordOrigin',
  investmentPlatforms: '&id, kind, defaultCurrency, cashAccountId, recordOrigin',
  assetClasses: '&id, &code, sortOrder, recordOrigin',
  holdings: '&id, platformId, assetClassId, symbol, recordOrigin',
  investmentActivities: '&id, platformId, holdingId, accountId, activityType, activityDate, recordOrigin',
  portfolioValuations: '&id, scope, platformId, holdingId, valuationDate, recordOrigin',
  emailConnections: '&id, installationId, provider, emailAddress, status',
  emailImportHistory: '&id, connectionId, installationId, externalMessageId, status, processedAt',
};

/**
 * Version 2: Backward-compatible index enhancements for linked transfers,
 * investment pools, partial buy/sell links, and compound date queries.
 */
export const SCHEMA_V2_STORES: Record<string, string> = {
  appInstallation: '&id, &installationId, schemaVersion, createdAt',
  preferences: '&id, installationId, baseCurrency, updatedAt',
  accounts: '&id, type, currency, platformId, recordOrigin, [type+recordOrigin], createdAt',
  categories: '&id, kind, sortOrder, recordOrigin, createdAt',
  subcategories: '&id, categoryId, sortOrder, recordOrigin, createdAt',
  transactions:
    '&id, accountId, toAccountId, transferGroupId, categoryId, subcategoryId, type, date, status, relatedHoldingId, recordOrigin, [accountId+date], [recordOrigin+date], createdAt',
  budgets: '&id, categoryId, subcategoryId, period, year, month, [year+month], recordOrigin',
  investmentPlatforms: '&id, kind, defaultCurrency, cashAccountId, recordOrigin',
  assetClasses: '&id, code, sortOrder, recordOrigin',
  holdings: '&id, platformId, assetClassId, poolAccountId, symbol, recordOrigin',
  investmentActivities:
    '&id, platformId, holdingId, accountId, linkedTransactionId, transferGroupId, activityType, activityDate, recordOrigin',
  portfolioValuations: '&id, scope, platformId, holdingId, valuationDate, [scope+valuationDate], recordOrigin',
  emailConnections: '&id, installationId, provider, emailAddress, status',
  emailImportHistory: '&id, connectionId, installationId, externalMessageId, matchedTransactionId, status, processedAt',
};

export const SCHEMA_V3_STORES: Record<string, string> = {
  ...SCHEMA_V2_STORES,
  preferences: '&id, installationId, baseCurrency, themePreference, language, updatedAt',
  categories: '&id, kind, sortOrder, recordOrigin, [kind+recordOrigin], createdAt',
  investmentPlatforms: '&id, kind, defaultCurrency, cashAccountId, recordOrigin, createdAt',
};

export const SCHEMA_V4_STORES: Record<string, string> = {
  ...SCHEMA_V3_STORES,
  transactions:
    '&id, accountId, toAccountId, transferGroupId, categoryId, subcategoryId, type, date, status, relatedHoldingId, recordOrigin, [accountId+date], [recordOrigin+date], [recordOrigin+type], [recordOrigin+accountId], createdAt',
};

export const SCHEMA_V5_STORES: Record<string, string> = {
  ...SCHEMA_V4_STORES,
  holdings:
    '&id, platformId, assetClassId, poolAccountId, symbol, recordOrigin, [recordOrigin+platformId], [recordOrigin+assetClassId], createdAt',
  investmentActivities:
    '&id, platformId, holdingId, accountId, toAccountId, linkedTransactionId, transferGroupId, activityType, activityDate, recordOrigin, [recordOrigin+activityDate], [recordOrigin+platformId], [recordOrigin+activityType], createdAt',
  portfolioValuations:
    '&id, scope, platformId, holdingId, valuationDate, [scope+valuationDate], [recordOrigin+valuationDate], [recordOrigin+scope], recordOrigin, createdAt',
};

export const SCHEMA_V6_STORES: Record<DatabaseTableName, string> = {
  ...(SCHEMA_V5_STORES as Record<DatabaseTableName, string>),
  budgets:
    '&id, categoryId, subcategoryId, period, year, month, periodKey, [year+month], [recordOrigin+periodKey], [recordOrigin+year+month], recordOrigin, createdAt',
  monthlyBudgetPlans:
    '&id, periodKey, year, month, currency, [recordOrigin+periodKey], recordOrigin, createdAt',
  budgetAlerts:
    '&id, alertKey, budgetId, categoryId, periodKey, thresholdType, status, [recordOrigin+periodKey], [recordOrigin+status], recordOrigin, createdAt',
};

export const SCHEMA_V7_STORES: Record<DatabaseTableName, string> = {
  ...SCHEMA_V6_STORES,
  preferences: '&id, installationId, baseCurrency, themePreference, language, updatedAt',
};

export const SCHEMA_V8_STORES: Record<DatabaseTableName, string> = {
  ...SCHEMA_V7_STORES,
};

export const DEFAULT_USER_CATEGORIES: Array<{
  id: string;
  name: string;
  kind: 'expense';
  sortOrder: number;
}> = [
  { id: 'cat_default_food', name: 'Food and Beverage', kind: 'expense', sortOrder: 1 },
  { id: 'cat_default_housing', name: 'Housing', kind: 'expense', sortOrder: 2 },
  { id: 'cat_default_transport', name: 'Transportation', kind: 'expense', sortOrder: 3 },
  { id: 'cat_default_shopping', name: 'Shopping', kind: 'expense', sortOrder: 4 },
  { id: 'cat_default_internet', name: 'Internet', kind: 'expense', sortOrder: 5 },
  { id: 'cat_default_office', name: 'Office', kind: 'expense', sortOrder: 6 },
  { id: 'cat_default_family', name: 'Family', kind: 'expense', sortOrder: 7 },
  { id: 'cat_default_subscription', name: 'Subscription', kind: 'expense', sortOrder: 8 },
  { id: 'cat_default_others', name: 'Others', kind: 'expense', sortOrder: 9 },
];

export const DEFAULT_INCOME_CATEGORIES: Array<{
  id: string;
  name: string;
  kind: 'income';
  sortOrder: number;
}> = [
  { id: 'cat_default_salary', name: 'Salary', kind: 'income', sortOrder: 10 },
  { id: 'cat_default_freelance', name: 'Freelance & Business', kind: 'income', sortOrder: 11 },
  { id: 'cat_default_investment_income', name: 'Investment Return', kind: 'income', sortOrder: 12 },
  { id: 'cat_default_bonus', name: 'Gift & Bonus', kind: 'income', sortOrder: 13 },
  { id: 'cat_default_other_income', name: 'Other Income', kind: 'income', sortOrder: 14 },
];

export const DEFAULT_INVESTMENT_PLATFORMS: Array<{
  id: string;
  name: string;
  kind: 'brokerage' | 'mutual_fund' | 'crypto_exchange';
  defaultCurrency: string;
  supportsInvestmentPool: boolean;
}> = [
  {
    id: 'plat_default_stockbit',
    name: 'Stockbit',
    kind: 'brokerage',
    defaultCurrency: 'IDR',
    supportsInvestmentPool: true,
  },
  {
    id: 'plat_default_pluang',
    name: 'Pluang',
    kind: 'mutual_fund',
    defaultCurrency: 'IDR',
    supportsInvestmentPool: true,
  },
  {
    id: 'plat_default_bitget',
    name: 'Bitget',
    kind: 'crypto_exchange',
    defaultCurrency: 'USD',
    supportsInvestmentPool: true,
  },
];

export const DEFAULT_ASSET_CLASSES: Array<{
  id: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
}> = [
  {
    id: 'ac_default_indo_stock',
    code: 'INDO_STOCK',
    name: 'Indo Stock',
    description: 'Indonesian equities listed on IDX (IHSG).',
    sortOrder: 1,
  },
  {
    id: 'ac_default_us_stock',
    code: 'US_STOCK',
    name: 'US Stock',
    description: 'US equities and ETFs (NYSE / NASDAQ).',
    sortOrder: 2,
  },
  {
    id: 'ac_default_crypto',
    code: 'CRYPTO',
    name: 'Crypto',
    description: 'Digital assets and cryptocurrencies.',
    sortOrder: 3,
  },
  {
    id: 'ac_default_gold',
    code: 'GOLD',
    name: 'Gold',
    description: 'Physical and digital gold holdings.',
    sortOrder: 4,
  },
];

export const TABLE_SCHEMA_CATALOG: TableSchemaMetadata[] = [
  {
    name: 'appInstallation',
    category: 'system',
    primaryKey: 'id',
    indexes: ['&id', '&installationId', 'schemaVersion', 'createdAt'],
    relationships: ['Referenced by preferences, emailConnections, emailImportHistory'],
    supportsTestIsolation: false,
    description: 'Singleton local installation identity persisted across browser refreshes.',
  },
  {
    name: 'preferences',
    category: 'system',
    primaryKey: 'id',
    indexes: ['&id', 'installationId', 'baseCurrency', 'updatedAt'],
    relationships: ['installationId -> appInstallation.installationId'],
    supportsTestIsolation: false,
    description: 'User settings initialized with IDR default currency and neutral Stage 1 theme posture.',
  },
  {
    name: 'accounts',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: ['&id', 'type', 'currency', 'platformId', 'recordOrigin', '[type+recordOrigin]', 'createdAt'],
    relationships: ['platformId -> investmentPlatforms.id (optional platform cash/pool link)'],
    supportsTestIsolation: true,
    description: 'Bank, cash, e-wallet, platform cash balance, and investment pool accounts.',
  },
  {
    name: 'categories',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: ['&id', 'kind', 'sortOrder', 'recordOrigin', 'createdAt'],
    relationships: ['Parent of subcategories and referenced by transactions/budgets'],
    supportsTestIsolation: true,
    description: 'Primary cashflow categories for income, expense, and transfer flows.',
  },
  {
    name: 'subcategories',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: ['&id', 'categoryId', 'sortOrder', 'recordOrigin', 'createdAt'],
    relationships: ['categoryId -> categories.id'],
    supportsTestIsolation: true,
    description: 'Granular subcategories scoped under a parent category.',
  },
  {
    name: 'transactions',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: [
      '&id',
      'accountId',
      'toAccountId',
      'transferGroupId',
      'categoryId',
      'subcategoryId',
      'type',
      'date',
      'status',
      'relatedHoldingId',
      'recordOrigin',
      '[accountId+date]',
      '[recordOrigin+date]',
    ],
    relationships: [
      'accountId -> accounts.id',
      'toAccountId -> accounts.id',
      'categoryId -> categories.id',
      'subcategoryId -> subcategories.id',
      'relatedHoldingId -> holdings.id',
    ],
    supportsTestIsolation: true,
    description: 'Financial ledger entries supporting income, expenses, linked transfers, and settlement references.',
  },
  {
    name: 'budgets',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: [
      '&id',
      'categoryId',
      'subcategoryId',
      'period',
      'year',
      'month',
      'periodKey',
      '[year+month]',
      '[recordOrigin+periodKey]',
      'recordOrigin',
    ],
    relationships: ['categoryId -> categories.id', 'subcategoryId -> subcategories.id'],
    supportsTestIsolation: true,
    description: 'Period budget targets by category with optional rollover and historical category snapshots.',
  },
  {
    name: 'monthlyBudgetPlans',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: ['&id', 'periodKey', 'year', 'month', 'currency', '[recordOrigin+periodKey]', 'recordOrigin'],
    relationships: ['Optional top-down monthly budget allocation ceiling paired with budgets'],
    supportsTestIsolation: true,
    description: 'User-confirmed total monthly budget ceiling per period and currency.',
  },
  {
    name: 'budgetAlerts',
    category: 'cashflow',
    primaryKey: 'id',
    indexes: [
      '&id',
      'alertKey',
      'budgetId',
      'categoryId',
      'periodKey',
      'thresholdType',
      'status',
      '[recordOrigin+periodKey]',
      'recordOrigin',
    ],
    relationships: ['budgetId -> budgets.id', 'categoryId -> categories.id'],
    supportsTestIsolation: true,
    description: 'Deduplicated local budget alerts for 80%, 100%, and over-budget thresholds.',
  },
  {
    name: 'investmentPlatforms',
    category: 'investment',
    primaryKey: 'id',
    indexes: ['&id', 'kind', 'defaultCurrency', 'cashAccountId', 'recordOrigin'],
    relationships: ['cashAccountId -> accounts.id (platform cash balance)'],
    supportsTestIsolation: true,
    description: 'Brokerages, custodians, and exchanges supporting cash balances and investment pools.',
  },
  {
    name: 'assetClasses',
    category: 'investment',
    primaryKey: 'id',
    indexes: ['&id', 'code', 'sortOrder', 'recordOrigin'],
    relationships: ['Referenced by holdings.assetClassId'],
    supportsTestIsolation: true,
    description: 'Asset taxonomy (equities, fixed income, money market, crypto, gold).',
  },
  {
    name: 'holdings',
    category: 'investment',
    primaryKey: 'id',
    indexes: ['&id', 'platformId', 'assetClassId', 'poolAccountId', 'symbol', 'recordOrigin'],
    relationships: [
      'platformId -> investmentPlatforms.id',
      'assetClassId -> assetClasses.id',
      'poolAccountId -> accounts.id',
    ],
    supportsTestIsolation: true,
    description: 'Tracked investment positions linked to platforms, asset classes, and optional investment pools.',
  },
  {
    name: 'investmentActivities',
    category: 'investment',
    primaryKey: 'id',
    indexes: [
      '&id',
      'platformId',
      'holdingId',
      'accountId',
      'linkedTransactionId',
      'transferGroupId',
      'activityType',
      'activityDate',
      'recordOrigin',
    ],
    relationships: [
      'platformId -> investmentPlatforms.id',
      'holdingId -> holdings.id',
      'accountId -> accounts.id',
      'linkedTransactionId -> transactions.id',
    ],
    supportsTestIsolation: true,
    description: 'Buy, partial sell, dividend, fee, and cash transfer events.',
  },
  {
    name: 'portfolioValuations',
    category: 'investment',
    primaryKey: 'id',
    indexes: ['&id', 'scope', 'platformId', 'holdingId', 'valuationDate', '[scope+valuationDate]', 'recordOrigin'],
    relationships: ['platformId -> investmentPlatforms.id', 'holdingId -> holdings.id'],
    supportsTestIsolation: true,
    description: 'Historical valuation snapshots across holding, platform, pool, and portfolio scopes.',
  },
  {
    name: 'emailConnections',
    category: 'integration',
    primaryKey: 'id',
    indexes: ['&id', 'installationId', 'provider', 'emailAddress', 'status'],
    relationships: ['installationId -> appInstallation.installationId'],
    supportsTestIsolation: false,
    description: 'Metadata for future server-side Gmail OAuth connections (no passwords or secrets stored).',
  },
  {
    name: 'emailImportHistory',
    category: 'integration',
    primaryKey: 'id',
    indexes: ['&id', 'connectionId', 'installationId', 'externalMessageId', 'matchedTransactionId', 'status', 'processedAt'],
    relationships: [
      'connectionId -> emailConnections.id',
      'installationId -> appInstallation.installationId',
      'matchedTransactionId -> transactions.id',
    ],
    supportsTestIsolation: false,
    description: 'Deduplication and audit log for future email transaction imports.',
  },
];
