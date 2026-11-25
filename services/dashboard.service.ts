import { liveQuery } from 'dexie';
import { ensureDatabaseOpen, getDatabase } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { ValidationError } from '@/lib/errors';
import { roundCurrencyAmount } from '@/lib/currency';
import {
  getPeriodDateRange,
  getPreviousEquivalentPeriodRange,
  getTodayInTimezone,
  nowIso,
  type DateRange,
  type ReportingPeriodPreset,
} from '@/lib/dates';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  accountsRepository,
  categoriesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  portfolioValuationsRepository,
  preferencesRepository,
  transactionsRepository,
} from '@/repositories';
import {
  calculateConsolidatedNetWorth,
  type AccountBalanceItem,
} from '@/services/account-balance.service';
import {
  buildDashboardAssetAllocation,
  buildExpenseBreakdown,
  buildIncomeVsExpenseSeries,
  buildNetWorthTrendSeries,
  resolveDefaultChartInterval,
  type DashboardAssetAllocationResult,
  type ExpenseBreakdownResult,
  type IncomeVsExpenseChartResult,
  type NetWorthTrendResult,
  type TrendInterval,
} from '@/services/dashboard-chart.service';
import {
  generateFinancialInsights,
  type FinancialInsightItem,
  type PeriodComparisonMetrics,
} from '@/services/financial-insight.service';
import {
  calculateFinancialSummary,
  type FinancialSummarySnapshot,
} from '@/services/financial-summary.service';
import {
  getInvestmentOverviewSnapshot,
  type InvestmentOverviewSnapshot,
} from '@/services/investment-summary.service';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import {
  listTransactionsFiltered,
  type EnrichedTransactionItem,
} from '@/services/transaction.service';
import type {
  Account,
  DateFormatPreference,
  ManualFxRateEntry,
  NumberFormatPreference,
  RecordOrigin,
} from '@/types/entities';

export type AccountDisplayGroupKey =
  | 'bank'
  | 'cash'
  | 'ewallet'
  | 'investment_pool'
  | 'investment_cash';

export interface GroupedAccountBalances {
  groupKey: AccountDisplayGroupKey;
  groupLabel: string;
  items: AccountBalanceItem[];
  totalsByCurrency: Record<string, number>;
}

export interface DashboardExcludedCurrencyItem {
  currency: string;
  liquidCashBalance: number;
  investmentValue: number;
  totalValue: number;
}

export interface DashboardMetricsSummary {
  baseCurrency: string;
  netWorth: number;
  liabilitiesSupported: boolean;
  availableCash: number;
  investmentValue: number;
  excludedCurrencies: string[];
  excludedCurrencyItems: DashboardExcludedCurrencyItem[];
  periodIncome: number;
  periodExpenses: number;
  periodNetCashFlow: number;
  savingsRatePct: number | null;
  comparison: PeriodComparisonMetrics;
  hasExcludedPeriodCashflowCurrencies: string[];
}

export interface DashboardSnapshot {
  generatedAt: string;
  today: string;
  profileName: string;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
  periodPreset: ReportingPeriodPreset;
  dateRange: DateRange;
  previousDateRange: DateRange | null;
  metrics: DashboardMetricsSummary;
  availableCashAccounts: AccountBalanceItem[];
  groupedAccountBalances: GroupedAccountBalances[];
  netWorthTrend: NetWorthTrendResult;
  incomeVsExpenses: IncomeVsExpenseChartResult;
  assetAllocation: DashboardAssetAllocationResult;
  expenseBreakdown: ExpenseBreakdownResult;
  investmentOverview: InvestmentOverviewSnapshot;
  financialSummary: FinancialSummarySnapshot;
  recentTransactions: EnrichedTransactionItem[];
  insights: FinancialInsightItem[];
  manualFxRates: ManualFxRateEntry[];
}

export interface DashboardQueryOptions {
  periodPreset?: ReportingPeriodPreset;
  customStart?: string | null;
  customEnd?: string | null;
  trendInterval?: TrendInterval;
  cashflowInterval?: TrendInterval;
  recordOrigin?: RecordOrigin;
  baseCurrency?: string;
  todayOverride?: string;
}

function classifyAccountGroup(acc: Account): AccountDisplayGroupKey {
  if (acc.type === 'investment_pool' || acc.isInvestmentPool) return 'investment_pool';
  if (acc.type === 'investment_cash') return 'investment_cash';
  if (acc.type === 'ewallet') return 'ewallet';
  if (acc.type === 'cash') return 'cash';
  return 'bank';
}

const ACCOUNT_GROUP_ORDER: Array<{ key: AccountDisplayGroupKey; label: string }> = [
  { key: 'bank', label: 'Bank Account' },
  { key: 'cash', label: 'Cash' },
  { key: 'ewallet', label: 'E-Wallet' },
  { key: 'investment_pool', label: 'Investment Pool' },
  { key: 'investment_cash', label: 'Platform Cash' },
];

export async function getDashboardSnapshot(
  options: DashboardQueryOptions = {}
): Promise<DashboardSnapshot> {
  const origin: RecordOrigin = options.recordOrigin ?? 'user';
  const periodPreset: ReportingPeriodPreset = options.periodPreset ?? 'this_month';

  const [
    prefsList,
    accounts,
    categories,
    transactions,
    investmentActivities,
    holdings,
    valuations,
    investmentOverview,
    recentTxResult,
  ] = await Promise.all([
    preferencesRepository.getAll(),
    origin === 'test' ? accountsRepository.getTestRecords() : accountsRepository.getUserRecords(),
    origin === 'test' ? categoriesRepository.getTestRecords() : categoriesRepository.getUserRecords(),
    origin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
    origin === 'test'
      ? portfolioValuationsRepository.getTestRecords()
      : portfolioValuationsRepository.getUserRecords(),
    getInvestmentOverviewSnapshot({
      recordOrigin: origin,
      baseCurrency: options.baseCurrency,
    }),
    listTransactionsFiltered({
      recordOrigin: origin,
      sortOrder: 'newest',
      page: 1,
      pageSize: 8,
    }),
  ]);

  const prefs = prefsList[0];
  const baseCurrency = (
    options.baseCurrency ||
    prefs?.baseCurrency ||
    APP_CONFIG.defaultCurrency
  ).toUpperCase();
  const timezone = prefs?.timezone ?? APP_CONFIG.defaultTimezone;
  const numberFormat: NumberFormatPreference =
    prefs?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat: DateFormatPreference = prefs?.dateFormat ?? APP_CONFIG.defaultDateFormat;
  const manualFxRates = prefs?.manualFxRates ?? [];
  const today = options.todayOverride ?? getTodayInTimezone(timezone);

  const dateRange = getPeriodDateRange(periodPreset, {
    timezone,
    customStart: options.customStart,
    customEnd: options.customEnd,
    todayOverride: options.todayOverride,
  });
  if (periodPreset === 'custom' && dateRange.startDate && dateRange.endDate && dateRange.startDate > dateRange.endDate) {
    throw new ValidationError('Start date must be on or before end date.');
  }
  const previousDateRange = getPreviousEquivalentPeriodRange(periodPreset, dateRange);

  // 1. Unified Point-in-Time Net Worth (reusing Stage 3/4 balance engine)
  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));
  const netWorthSnapshot = calculateConsolidatedNetWorth(
    sortedAccounts,
    transactions,
    investmentActivities,
    holdings
  );

  // Available Cash = strictly active/non-archived Bank, Cash, and E-Wallet accounts
  const availableCashAccounts = netWorthSnapshot.balances.items.filter(
    (item) =>
      !item.account.isArchived &&
      (item.account.type === 'bank' ||
        item.account.type === 'cash' ||
        item.account.type === 'ewallet')
  );

  const excludedCurrencySet = new Set<string>();
  const excludedCurrencyItems: DashboardExcludedCurrencyItem[] = [];

  let convertedAvailableCash = 0;
  let convertedInvestmentValue = 0;
  let convertedNetWorth = 0;

  // Compute Available Cash cleanly from Bank + Cash + E-Wallet accounts
  for (const item of availableCashAccounts) {
    const code = item.account.currency.toUpperCase();
    const rate = findManualFxRate(manualFxRates, code, baseCurrency);
    if (!rate) {
      excludedCurrencySet.add(code);
      continue;
    }
    const conv = convertCurrencyWithManualRate(
      item.currentBalance,
      code,
      baseCurrency,
      rate
    ).convertedAmount;
    convertedAvailableCash = roundCurrencyAmount(
      addDecimal(convertedAvailableCash, conv),
      baseCurrency
    );
  }

  // Compute consolidated Net Worth & Investment Value reusing Stage 3/4 currency buckets
  for (const bucket of Object.values(netWorthSnapshot.byCurrency)) {
    const rate = findManualFxRate(manualFxRates, bucket.currency, baseCurrency);
    if (!rate) {
      if (bucket.totalNetWorth !== 0 || bucket.liquidCashBalance !== 0 || bucket.totalInvestmentValue !== 0) {
        excludedCurrencySet.add(bucket.currency);
        excludedCurrencyItems.push({
          currency: bucket.currency,
          liquidCashBalance: bucket.liquidCashBalance,
          investmentValue: bucket.totalInvestmentValue,
          totalValue: bucket.totalNetWorth,
        });
      }
      continue;
    }

    const invConv = convertCurrencyWithManualRate(
      bucket.totalInvestmentValue,
      bucket.currency,
      baseCurrency,
      rate
    ).convertedAmount;
    const nwConv = convertCurrencyWithManualRate(
      bucket.totalNetWorth,
      bucket.currency,
      baseCurrency,
      rate
    ).convertedAmount;

    convertedInvestmentValue = roundCurrencyAmount(
      addDecimal(convertedInvestmentValue, invConv),
      baseCurrency
    );
    convertedNetWorth = roundCurrencyAmount(
      addDecimal(convertedNetWorth, nwConv),
      baseCurrency
    );
  }

  // 2. Period Cashflow (reusing Stage 3 calculateFinancialSummary)
  const financialSummary = calculateFinancialSummary(transactions, {
    periodPreset,
    dateRange,
    primaryCurrency: baseCurrency,
  });

  const previousFinancialSummary = previousDateRange
    ? calculateFinancialSummary(transactions, {
        periodPreset,
        dateRange: previousDateRange,
        primaryCurrency: baseCurrency,
      })
    : null;

  const excludedPeriodCashflowSet = new Set<string>();
  const sumCashflowInBase = (
    summary: FinancialSummarySnapshot
  ): { income: number; expenses: number; net: number } => {
    let income = 0;
    let expenses = 0;
    for (const bucket of Object.values(summary.byCurrency)) {
      if (bucket.totalIncome === 0 && bucket.totalExpenses === 0) continue;
      const rate = findManualFxRate(manualFxRates, bucket.currency, baseCurrency);
      if (!rate) {
        excludedPeriodCashflowSet.add(bucket.currency);
        continue;
      }
      income = roundCurrencyAmount(
        addDecimal(
          income,
          convertCurrencyWithManualRate(bucket.totalIncome, bucket.currency, baseCurrency, rate)
            .convertedAmount
        ),
        baseCurrency
      );
      expenses = roundCurrencyAmount(
        addDecimal(
          expenses,
          convertCurrencyWithManualRate(bucket.totalExpenses, bucket.currency, baseCurrency, rate)
            .convertedAmount
        ),
        baseCurrency
      );
    }
    return {
      income,
      expenses,
      net: roundCurrencyAmount(subtractDecimal(income, expenses), baseCurrency),
    };
  };

  const currentFlow = sumCashflowInBase(financialSummary);
  const previousFlow = previousFinancialSummary ? sumCashflowInBase(previousFinancialSummary) : null;

  const incomeChangeAbs =
    previousFlow !== null
      ? roundCurrencyAmount(subtractDecimal(currentFlow.income, previousFlow.income), baseCurrency)
      : null;
  const incomeChangePct =
    previousFlow !== null && previousFlow.income > 0 && incomeChangeAbs !== null
      ? roundUnitPrice((incomeChangeAbs / previousFlow.income) * 100)
      : null;

  const expenseChangeAbs =
    previousFlow !== null
      ? roundCurrencyAmount(
          subtractDecimal(currentFlow.expenses, previousFlow.expenses),
          baseCurrency
        )
      : null;
  const expenseChangePct =
    previousFlow !== null && previousFlow.expenses > 0 && expenseChangeAbs !== null
      ? roundUnitPrice((expenseChangeAbs / previousFlow.expenses) * 100)
      : null;

  const netCashFlowChangeAbs =
    previousFlow !== null
      ? roundCurrencyAmount(subtractDecimal(currentFlow.net, previousFlow.net), baseCurrency)
      : null;

  const savingsRatePct =
    currentFlow.income > 0 ? roundUnitPrice((currentFlow.net / currentFlow.income) * 100) : null;

  const comparison: PeriodComparisonMetrics = {
    currentIncome: currentFlow.income,
    previousIncome: previousFlow?.income ?? null,
    incomeChangeAbs,
    incomeChangePct,
    currentExpenses: currentFlow.expenses,
    previousExpenses: previousFlow?.expenses ?? null,
    expenseChangeAbs,
    expenseChangePct,
    currentNetCashFlow: currentFlow.net,
    previousNetCashFlow: previousFlow?.net ?? null,
    netCashFlowChangeAbs,
    savingsRatePct,
  };

  // 3. Grouped Account Balances
  const groupedAccountBalances: GroupedAccountBalances[] = ACCOUNT_GROUP_ORDER.map((group) => {
    const items = netWorthSnapshot.balances.items.filter(
      (item) => !item.account.isArchived && classifyAccountGroup(item.account) === group.key
    );
    const totalsByCurrency: Record<string, number> = {};
    for (const item of items) {
      const code = item.account.currency.toUpperCase();
      totalsByCurrency[code] = roundCurrencyAmount(
        addDecimal(totalsByCurrency[code] ?? 0, item.currentBalance),
        code
      );
    }
    return {
      groupKey: group.key,
      groupLabel: group.label,
      items,
      totalsByCurrency,
    };
  });

  // 4. Charts & Analytics Aggregations
  const defaultInterval = resolveDefaultChartInterval(periodPreset, dateRange);
  const trendInterval = options.trendInterval ?? defaultInterval;
  const cashflowInterval = options.cashflowInterval ?? defaultInterval;

  const netWorthTrend = buildNetWorthTrendSeries({
    accounts: sortedAccounts,
    transactions,
    investmentActivities,
    holdings,
    valuations,
    manualFxRates,
    baseCurrency,
    dateRange,
    interval: trendInterval,
    firstDayOfWeek: prefs?.firstDayOfWeek,
    today,
  });

  const incomeVsExpenses = buildIncomeVsExpenseSeries({
    transactions,
    manualFxRates,
    baseCurrency,
    dateRange,
    interval: cashflowInterval,
    firstDayOfWeek: prefs?.firstDayOfWeek,
  });

  const assetAllocation = buildDashboardAssetAllocation({
    netWorth: netWorthSnapshot,
    investmentOverview,
    manualFxRates,
    baseCurrency,
  });

  const expenseBreakdown = buildExpenseBreakdown({
    transactions,
    categories,
    manualFxRates,
    baseCurrency,
    currentRange: dateRange,
    previousRange: previousDateRange,
  });

  // 5. Deterministic Local Financial Insights
  const insights = generateFinancialInsights({
    baseCurrency,
    numberFormat,
    dateFormat,
    dateRange,
    transactions,
    comparison,
    expenseBreakdown,
    assetAllocation,
    netWorthTrend,
    accountBalances: netWorthSnapshot.balances.items,
  });

  return {
    generatedAt: nowIso(),
    today,
    profileName: prefs?.profileName?.trim() || '',
    baseCurrency,
    timezone,
    numberFormat,
    dateFormat,
    periodPreset,
    dateRange,
    previousDateRange,
    metrics: {
      baseCurrency,
      netWorth: convertedNetWorth,
      liabilitiesSupported: false,
      availableCash: convertedAvailableCash,
      investmentValue: convertedInvestmentValue,
      excludedCurrencies: Array.from(excludedCurrencySet).sort(),
      excludedCurrencyItems,
      periodIncome: currentFlow.income,
      periodExpenses: currentFlow.expenses,
      periodNetCashFlow: currentFlow.net,
      savingsRatePct,
      comparison,
      hasExcludedPeriodCashflowCurrencies: Array.from(excludedPeriodCashflowSet).sort(),
    },
    availableCashAccounts,
    groupedAccountBalances,
    netWorthTrend,
    incomeVsExpenses,
    assetAllocation,
    expenseBreakdown,
    investmentOverview,
    financialSummary,
    recentTransactions: recentTxResult.items,
    insights,
    manualFxRates,
  };
}

/**
 * Subscribes to IndexedDB mutations across financial and investment tables via Dexie liveQuery
 * inside the service layer so Dashboard UI stays reactive without importing Dexie directly.
 */
export function subscribeToDashboardChanges(onChange: () => void): () => void {
  if (typeof globalThis.indexedDB === 'undefined') {
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialized = false;
  let subscription: { unsubscribe: () => void } | null = null;
  let cancelled = false;

  ensureDatabaseOpen()
    .then(() => {
      if (cancelled) return;
      const db = getDatabase();
      const observable = liveQuery(async () => {
        const counts = await Promise.all([
          db.accounts.count(),
          db.transactions.count(),
          db.categories.count(),
          db.investmentPlatforms.count(),
          db.assetClasses.count(),
          db.holdings.count(),
          db.investmentActivities.count(),
          db.portfolioValuations.count(),
          db.preferences.count(),
        ]);
        // Also sample latest updated timestamps so edits/updates trigger reactivity cleanly
        const [latestTx, latestAct, latestHold, latestAcc, latestPref] = await Promise.all([
          db.transactions.orderBy('updatedAt').last(),
          db.investmentActivities.orderBy('updatedAt').last(),
          db.holdings.orderBy('updatedAt').last(),
          db.accounts.orderBy('updatedAt').last(),
          db.preferences.toCollection().first(),
        ]);
        return [
          ...counts,
          latestTx?.updatedAt ?? '',
          latestAct?.updatedAt ?? '',
          latestHold?.updatedAt ?? '',
          latestAcc?.updatedAt ?? '',
          latestPref?.updatedAt ?? '',
        ].join('|');
      });

      subscription = observable.subscribe({
        next: () => {
          if (!initialized) {
            initialized = true;
            return;
          }
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            onChange();
          }, 60);
        },
        error: () => {
          // Non-fatal reactive listener fallback; manual refresh remains available
        },
      });
    })
    .catch(() => {
      // Handled by main loader
    });

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (subscription) subscription.unsubscribe();
  };
}
