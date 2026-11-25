export type RecordOrigin = 'user' | 'test';

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestTaggedEntity extends BaseEntity {
  /**
   * Explicit marker separating internal Stage 1 verification records from real user data.
   * Stored alongside indexed `recordOrigin` so IndexedDB never indexes raw booleans.
   */
  isTestData: boolean;
  recordOrigin: RecordOrigin;
}

/**
 * 1. appInstallation
 * Singleton installation identity generated once on first launch.
 */
export interface AppInstallation extends BaseEntity {
  installationId: string;
  schemaVersion: number;
  appLabel: string;
  lastOpenedAt: string;
}

/**
 * 2. preferences
 * Local user preferences and personal profile metadata.
 */
export type ThemePreference = 'light' | 'dark' | 'system' | 'neutral';
export type NumberFormatPreference = 'id-ID' | 'en-US';
export type DateFormatPreference = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
export type FirstDayOfWeekPreference = 'monday' | 'sunday';
export type LanguagePreference = 'en' | 'id';

export interface ManualFxRateEntry {
  id?: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  createdAt?: string;
  updatedAt: string;
  notes?: string;
}

export interface BudgetAlertPreferences {
  nearLimitThresholdPct: number;
  overBudgetThresholdPct: number;
  enableNearLimitAlerts: boolean;
  enableFullLimitAlerts: boolean;
  enableOverBudgetAlerts: boolean;
}

export interface UserPreferences extends BaseEntity {
  installationId: string;
  baseCurrency: string;
  locale: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
  firstDayOfWeek: FirstDayOfWeekPreference;
  language: LanguagePreference;
  timezone: string;
  fiscalMonthStart: number;
  themePreference: ThemePreference;
  profileName: string;
  profileEmail: string;
  profileAvatar: string;
  profileDescription?: string;
  privacyMode?: boolean;
  lastBackupAt?: string;
  manualFxRates?: ManualFxRateEntry[];
  budgetAlertPreferences?: BudgetAlertPreferences;
}

/**
 * 3. accounts
 * Supports standard bank/cash/ewallet accounts as well as platform cash balances / investment pools.
 */
export type AccountType =
  | 'cash'
  | 'bank'
  | 'ewallet'
  | 'credit_card'
  | 'investment_cash'
  | 'investment_pool'
  | 'other';

export interface Account extends TestTaggedEntity {
  name: string;
  type: AccountType;
  currency: string;
  initialBalance: number;
  institutionName?: string;
  platformId?: string;
  isInvestmentPool?: boolean;
  isArchived: boolean;
  notes?: string;
  sortOrder?: number;
}

/**
 * 4. categories
 */
export type CategoryKind = 'income' | 'expense' | 'transfer';

export interface Category extends TestTaggedEntity {
  name: string;
  kind: CategoryKind;
  icon?: string;
  sortOrder: number;
  isDefault?: boolean;
  isArchived: boolean;
}

/**
 * 5. subcategories
 */
export interface Subcategory extends TestTaggedEntity {
  categoryId: string;
  name: string;
  sortOrder: number;
  isArchived: boolean;
}

/**
 * 6. transactions
 * Supports standard income/expense, linked transfers, and future investment cash settlements.
 */
export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransactionStatus = 'posted' | 'pending' | 'reconciled';

export interface Transaction extends TestTaggedEntity {
  accountId: string;
  toAccountId?: string;
  transferGroupId?: string;
  categoryId?: string;
  subcategoryId?: string;
  type: TransactionType;
  amount: number;
  currency: string;
  date: string;
  description: string;
  merchant?: string;
  status: TransactionStatus;
  relatedHoldingId?: string;
  relatedInvestmentActivityId?: string;
  emailImportId?: string;
  notes?: string;
}

/**
 * 7. budgets
 */
export type BudgetPeriod = 'monthly' | 'quarterly' | 'annual';

export interface Budget extends TestTaggedEntity {
  name?: string;
  categoryId: string;
  categoryNameSnapshot?: string;
  subcategoryId?: string;
  period: BudgetPeriod;
  year: number;
  month?: number;
  periodKey?: string;
  startDate?: string;
  endDate?: string;
  limitAmount: number;
  currency: string;
  rolloverEnabled: boolean;
  rolloverAmount?: number;
  rolloverSourceBudgetId?: string;
  isActive?: boolean;
  notes?: string;
}

/**
 * 7b. monthlyBudgetPlans
 * Optional user-confirmed monthly total budget ceiling for category allocation.
 */
export interface MonthlyBudgetPlan extends TestTaggedEntity {
  periodKey: string;
  year: number;
  month: number;
  totalBudgetAmount: number;
  currency: string;
  notes?: string;
  isActive: boolean;
}

/**
 * 7c. budgetAlerts
 * Deduplicated local budget threshold alert records (80%, 100%, >100%).
 */
export type BudgetAlertThresholdType = 'near_limit_80' | 'reached_100' | 'over_budget';
export type BudgetAlertStatus = 'active' | 'dismissed' | 'resolved';

export interface BudgetAlert extends TestTaggedEntity {
  alertKey: string;
  budgetId: string;
  categoryId: string;
  categoryNameSnapshot: string;
  periodKey: string;
  currency: string;
  thresholdType: BudgetAlertThresholdType;
  thresholdPct: number;
  utilizationPct: number;
  budgetAmount: number;
  actualAmount: number;
  status: BudgetAlertStatus;
  triggeredAt: string;
  lastEvaluatedAt: string;
  dismissedAt?: string;
}

/**
 * 8. investmentPlatforms
 * Supports brokers, mutual fund platforms, crypto exchanges, and platform cash / pool models.
 */
export type PlatformKind = 'brokerage' | 'mutual_fund' | 'crypto_exchange' | 'bank_custodian' | 'other';

export interface InvestmentPlatform extends TestTaggedEntity {
  name: string;
  kind: PlatformKind;
  defaultCurrency: string;
  cashAccountId?: string;
  supportsInvestmentPool: boolean;
  isDefault?: boolean;
  isArchived: boolean;
  notes?: string;
  sortOrder?: number;
}

/**
 * 9. assetClasses
 */
export interface AssetClass extends TestTaggedEntity {
  code: string;
  name: string;
  description?: string;
  sortOrder: number;
  isDefault?: boolean;
  isArchived?: boolean;
}

/**
 * 10. holdings
 */
export interface Holding extends TestTaggedEntity {
  platformId: string;
  assetClassId: string;
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  averageCostPerUnit: number;
  remainingCostBasis?: number;
  currentPrice?: number;
  currentMarketValue?: number;
  priceRecorded?: boolean;
  lastValuationDate?: string;
  realizedPnlTotal?: number;
  poolAccountId?: string;
  isArchived: boolean;
  notes?: string;
}

/**
 * 11. investmentActivities
 * Supports contributions, withdrawals, platform transfers, buys, sells, dividends, interest, fees, and valuation updates.
 */
export type InvestmentActivityType =
  | 'contribution'
  | 'withdrawal'
  | 'platform_transfer'
  | 'buy'
  | 'sell'
  | 'partial_sell'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'valuation_update'
  | 'deposit'
  | 'split'
  | 'valuation_adjustment';

export interface InvestmentActivity extends TestTaggedEntity {
  platformId: string;
  toPlatformId?: string;
  holdingId?: string;
  accountId?: string;
  toAccountId?: string;
  linkedTransactionId?: string;
  transferGroupId?: string;
  activityType: InvestmentActivityType;
  quantity?: number;
  unitPrice?: number;
  grossAmount: number;
  feeAmount: number;
  netAmount?: number;
  allocatedCostBasis?: number;
  realizedPnl?: number;
  currency: string;
  fxRateToBase?: number;
  fxRateDate?: string;
  fxBaseCurrency?: string;
  /** Cash settlement recorded separately from the holding's native currency. */
  settlementAmount?: number;
  settlementCurrency?: string;
  settlementFxRate?: number;
  settlementFxRateDate?: string;
  activityDate: string;
  description?: string;
  notes?: string;
}

/**
 * 12. portfolioValuations
 * Historical snapshots at holding, platform, pool, or total portfolio scope.
 */
export type ValuationScope = 'holding' | 'platform' | 'pool' | 'portfolio';

export interface PortfolioValuation extends TestTaggedEntity {
  scope: ValuationScope;
  platformId?: string;
  holdingId?: string;
  valuationDate: string;
  unitPrice?: number;
  marketValue: number;
  costBasis?: number;
  currency: string;
  fxRateToBase?: number;
  fxRateDate?: string;
  baseCurrency?: string;
  convertedMarketValue?: number;
  notes?: string;
  source: 'manual' | 'import' | 'computed';
}

/**
 * 13. emailConnections
 * Prepared schema for future server-side Gmail OAuth associated with installationId.
 * Strictly prohibits storing passwords or OAuth client secrets locally.
 */
export type EmailProvider = 'gmail';
export type EmailConnectionStatus = 'disconnected' | 'connected' | 'token_expired' | 'revoked';

export interface EmailConnection extends BaseEntity {
  installationId: string;
  provider: EmailProvider;
  emailAddress: string;
  status: EmailConnectionStatus;
  lastSyncedAt?: string;
  syncCursor?: string;
}

/**
 * 14. emailImportHistory
 */
export type EmailImportStatus = 'imported' | 'skipped' | 'duplicate' | 'failed';

export interface EmailImportHistory extends BaseEntity {
  connectionId: string;
  installationId: string;
  externalMessageId: string;
  subjectSummary?: string;
  receivedAt: string;
  processedAt: string;
  status: EmailImportStatus;
  matchedTransactionId?: string;
  errorMessage?: string;
}
