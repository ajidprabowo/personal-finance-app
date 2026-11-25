import { liveQuery } from 'dexie';
import { ensureDatabaseOpen, getDatabase } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import { formatDisplayDate, nowIso } from '@/lib/dates';
import { addDecimal, roundUnitPrice } from '@/lib/precision';
import {
  accountsRepository,
  assetClassesRepository,
  budgetsRepository,
  categoriesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  investmentPlatformsRepository,
  portfolioValuationsRepository,
  preferencesRepository,
  transactionsRepository,
} from '@/repositories';
import { calculateConsolidatedNetWorth } from '@/services/account-balance.service';
import {
  resolveAnalyticsContext,
  type AnalyticsFilterOptions,
  type ResolvedAnalyticsContext,
} from '@/services/analytics-filter.service';
import {
  evaluateMonthlyBudgets,
  formatPeriodLabel,
} from '@/services/budget-calculation.service';
import {
  computeExpenseAnalytics,
  type ExpenseAnalyticsResult,
} from '@/services/expense-analytics.service';
import type { FinancialInsightItem } from '@/services/financial-insight.service';
import {
  computeIncomeAnalytics,
  type IncomeAnalyticsResult,
} from '@/services/income-analytics.service';
import {
  computeInvestmentAnalytics,
  type InvestmentAnalyticsResult,
} from '@/services/investment-analytics.service';
import { getInvestmentOverviewSnapshot } from '@/services/investment-summary.service';
import {
  computeNetWorthAnalytics,
  type NetWorthAnalyticsResult,
} from '@/services/net-worth-analytics.service';
import { getPortfolioPerformanceHistory } from '@/services/portfolio-performance.service';
import {
  computeSavingsAnalytics,
  type SavingsAnalyticsResult,
} from '@/services/savings-analytics.service';
import {
  computeSpendingBehavior,
  type SpendingBehaviorResult,
} from '@/services/spending-behavior.service';
import type {
  Account,
  AssetClass,
  Category,
  DateFormatPreference,
  Holding,
  InvestmentPlatform,
  ManualFxRateEntry,
  NumberFormatPreference,
  RecordOrigin,
} from '@/types/entities';

export type HealthIndicatorStatus = 'healthy' | 'caution' | 'attention' | 'insufficient';

export interface FinancialHealthIndicator {
  id:
    | 'savings_rate'
    | 'expense_to_income_ratio'
    | 'cash_to_investment_ratio'
    | 'budget_utilization'
    | 'net_worth_growth';
  label: string;
  value: number | null;
  formattedValue: string;
  status: HealthIndicatorStatus;
  formula: string;
  reportingPeriod: string;
  dataSummary: string;
}

export interface AnalyticsOverviewSummary {
  currency: string;
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  savingsRatePct: number | null;
  expenseToIncomeRatioPct: number | null;
  netWorth: number;
  investmentValue: number;
  availableCash: number;
  currentMonthBudgetUtilizationPct: number | null;
}

export interface AnalyticsSnapshot {
  generatedAt: string;
  context: ResolvedAnalyticsContext;
  timezone: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
  overview: AnalyticsOverviewSummary;
  income: IncomeAnalyticsResult;
  expenses: ExpenseAnalyticsResult;
  spendingBehavior: SpendingBehaviorResult;
  savings: SavingsAnalyticsResult;
  investments: InvestmentAnalyticsResult;
  netWorth: NetWorthAnalyticsResult;
  healthIndicators: FinancialHealthIndicator[];
  insights: FinancialInsightItem[];
  filterOptions: {
    accounts: Account[];
    categories: Category[];
    platforms: InvestmentPlatform[];
    assetClasses: AssetClass[];
    holdings: Holding[];
  };
  manualFxRates: ManualFxRateEntry[];
  excludedCurrencies: string[];
}

function buildFinancialHealthIndicators(params: {
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
  savings: SavingsAnalyticsResult;
  netWorth: NetWorthAnalyticsResult;
  budgetSummary: ReturnType<typeof evaluateMonthlyBudgets>['summary'];
  budgetPeriodLabel: string;
  periodLabel: string;
}): FinancialHealthIndicator[] {
  const {
    baseCurrency,
    numberFormat,
    savings,
    netWorth,
    budgetSummary,
    budgetPeriodLabel,
    periodLabel,
  } = params;
  const fmt = (amt: number) => formatCurrency(amt, baseCurrency, numberFormat);

  // 1. Savings Rate
  const savingsIndicator: FinancialHealthIndicator =
    savings.savingsRatePct === null
      ? {
          id: 'savings_rate',
          label: 'Savings Rate',
          value: null,
          formattedValue: 'Unavailable (no income)',
          status: 'insufficient',
          formula: '(Total Income - Total Expenses) / Total Income × 100',
          reportingPeriod: periodLabel,
          dataSummary: `Income ${fmt(savings.totalIncome)} · Expenses ${fmt(savings.totalExpenses)}`,
        }
      : {
          id: 'savings_rate',
          label: 'Savings Rate',
          value: savings.savingsRatePct,
          formattedValue: `${savings.savingsRatePct.toFixed(1)}%`,
          status:
            savings.savingsRatePct >= 20
              ? 'healthy'
              : savings.savingsRatePct >= 0
                ? 'caution'
                : 'attention',
          formula: '(Total Income - Total Expenses) / Total Income × 100',
          reportingPeriod: periodLabel,
          dataSummary: `Net savings ${fmt(savings.totalSavings)} from ${fmt(savings.totalIncome)} income`,
        };

  // 2. Expense-to-Income Ratio
  const expRatioIndicator: FinancialHealthIndicator =
    savings.expenseToIncomeRatioPct === null
      ? {
          id: 'expense_to_income_ratio',
          label: 'Expense-to-Income Ratio',
          value: null,
          formattedValue: 'Unavailable (no income)',
          status: 'insufficient',
          formula: 'Total Expenses / Total Income × 100',
          reportingPeriod: periodLabel,
          dataSummary: `Expenses ${fmt(savings.totalExpenses)} recorded with zero income in period`,
        }
      : {
          id: 'expense_to_income_ratio',
          label: 'Expense-to-Income Ratio',
          value: savings.expenseToIncomeRatioPct,
          formattedValue: `${savings.expenseToIncomeRatioPct.toFixed(1)}%`,
          status:
            savings.expenseToIncomeRatioPct <= 80
              ? 'healthy'
              : savings.expenseToIncomeRatioPct <= 100
                ? 'caution'
                : 'attention',
          formula: 'Total Expenses / Total Income × 100',
          reportingPeriod: periodLabel,
          dataSummary: `${fmt(savings.totalExpenses)} spent out of ${fmt(savings.totalIncome)} earned`,
        };

  // 3. Cash-to-Investment Ratio
  const cashInvIndicator: FinancialHealthIndicator =
    netWorth.availableCash === 0 && netWorth.investmentValue === 0
      ? {
          id: 'cash_to_investment_ratio',
          label: 'Cash-to-Investment Ratio',
          value: null,
          formattedValue: 'Unavailable',
          status: 'insufficient',
          formula: 'Available Liquid Cash / Total Investment Value',
          reportingPeriod: 'Current Snapshot',
          dataSummary: 'No cash or investment balances recorded yet',
        }
      : netWorth.investmentValue <= 0
        ? {
            id: 'cash_to_investment_ratio',
            label: 'Cash-to-Investment Ratio',
            value: null,
            formattedValue: '100% Cash (0 investments)',
            status: 'caution',
            formula: 'Available Liquid Cash / Total Investment Value',
            reportingPeriod: 'Current Snapshot',
            dataSummary: `Available Cash ${fmt(netWorth.availableCash)} · Investments ${fmt(0)}`,
          }
        : {
            id: 'cash_to_investment_ratio',
            label: 'Cash-to-Investment Ratio',
            value: netWorth.cashToInvestmentRatio,
            formattedValue: `${(netWorth.cashToInvestmentRatio ?? 0).toFixed(2)}x (${
              netWorth.cashSharePct?.toFixed(1) ?? '0.0'
            }% cash)`,
            status: 'healthy',
            formula: 'Available Liquid Cash / Total Investment Value',
            reportingPeriod: 'Current Snapshot',
            dataSummary: `Cash ${fmt(netWorth.availableCash)} vs Investments ${fmt(
              netWorth.investmentValue
            )}`,
          };

  // 4. Budget Utilization (Current Active Month)
  const budgetUtilIndicator: FinancialHealthIndicator =
    budgetSummary.activeBudgetCount === 0 || budgetSummary.utilizationPct === null
      ? {
          id: 'budget_utilization',
          label: 'Budget Utilization',
          value: null,
          formattedValue: 'No active budgets',
          status: 'insufficient',
          formula: 'Total Actual Budgeted Expenses / Total Active Monthly Budgets × 100',
          reportingPeriod: budgetPeriodLabel,
          dataSummary: `No active monthly category budgets configured for ${budgetPeriodLabel}`,
        }
      : {
          id: 'budget_utilization',
          label: 'Budget Utilization',
          value: budgetSummary.utilizationPct,
          formattedValue: `${budgetSummary.utilizationPct.toFixed(1)}%`,
          status:
            budgetSummary.utilizationPct <= 80
              ? 'healthy'
              : budgetSummary.utilizationPct <= 100
                ? 'caution'
                : 'attention',
          formula: 'Total Actual Budgeted Expenses / Total Active Monthly Budgets × 100',
          reportingPeriod: budgetPeriodLabel,
          dataSummary: `${fmt(budgetSummary.totalActualBudgetedExpenses)} of ${fmt(
            budgetSummary.totalBudget
          )} used across ${budgetSummary.activeBudgetCount} budget(s)`,
        };

  // 5. Net Worth Growth
  const nwGrowthIndicator: FinancialHealthIndicator =
    netWorth.periodGrowthAbs === null || netWorth.periodGrowthPct === null
      ? {
          id: 'net_worth_growth',
          label: 'Net Worth Growth',
          value: null,
          formattedValue: 'Insufficient checkpoints',
          status: 'insufficient',
          formula: '(Ending Net Worth - Starting Net Worth) / |Starting Net Worth| × 100',
          reportingPeriod: periodLabel,
          dataSummary: 'Requires at least two distinct dated checkpoints in period',
        }
      : {
          id: 'net_worth_growth',
          label: 'Net Worth Growth',
          value: netWorth.periodGrowthPct,
          formattedValue: `${netWorth.periodGrowthPct >= 0 ? '+' : ''}${netWorth.periodGrowthPct.toFixed(
            1
          )}%`,
          status:
            netWorth.periodGrowthAbs > 0
              ? 'healthy'
              : netWorth.periodGrowthAbs === 0
                ? 'caution'
                : 'attention',
          formula: '(Ending Net Worth - Starting Net Worth) / |Starting Net Worth| × 100',
          reportingPeriod: periodLabel,
          dataSummary: `${netWorth.periodGrowthAbs >= 0 ? '+' : ''}${fmt(
            netWorth.periodGrowthAbs
          )} net change over ${netWorth.trend.points.length} checkpoints`,
        };

  return [
    savingsIndicator,
    expRatioIndicator,
    cashInvIndicator,
    budgetUtilIndicator,
    nwGrowthIndicator,
  ];
}

function generateAnalyticsInsights(params: {
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
  income: IncomeAnalyticsResult;
  expenses: ExpenseAnalyticsResult;
  spendingBehavior: SpendingBehaviorResult;
  savings: SavingsAnalyticsResult;
  investments: InvestmentAnalyticsResult;
  netWorth: NetWorthAnalyticsResult;
  budgetEval: ReturnType<typeof evaluateMonthlyBudgets>;
  budgetPeriodLabel: string;
}): FinancialInsightItem[] {
  const {
    baseCurrency,
    numberFormat,
    dateFormat,
    income,
    expenses,
    spendingBehavior,
    savings,
    investments,
    netWorth,
    budgetEval,
    budgetPeriodLabel,
  } = params;
  const insights: FinancialInsightItem[] = [];
  const fmt = (amt: number, cur: string = baseCurrency) =>
    formatCurrency(amt, cur, numberFormat);

  // 1. Top expense category
  if (expenses.byCategory.length > 0 && expenses.totalExpenses > 0) {
    const top = expenses.byCategory[0];
    insights.push({
      id: 'analytics_top_expense_category',
      category: 'expense_category',
      title: `Highest spending category: ${top.categoryName}`,
      description: `${top.categoryName} accounted for ${top.percentageOfTotal.toFixed(
        1
      )}% of expenses (${fmt(top.amount)}) across ${top.transactionCount} transaction${
        top.transactionCount === 1 ? '' : 's'
      }.`,
      tone: 'neutral',
    });
  }

  // 2. Budget overrun observation (strictly backed by active month budgets)
  const overBudgetItems = budgetEval.items.filter((i) => i.status === 'over_budget');
  if (overBudgetItems.length > 0) {
    const worst = [...overBudgetItems].sort(
      (a, b) => (b.utilizationPct ?? 999) - (a.utilizationPct ?? 999)
    )[0];
    insights.push({
      id: 'analytics_budget_overrun',
      category: 'expense_trend',
      title: `${overBudgetItems.length} categor${
        overBudgetItems.length === 1 ? 'y' : 'ies'
      } over budget in ${budgetPeriodLabel}`,
      description: `${worst.categoryName} reached ${
        worst.utilizationPct !== null ? `${worst.utilizationPct.toFixed(1)}%` : 'over limit'
      } (${fmt(worst.actualAmount, worst.currency)} spent vs ${fmt(
        worst.availableBudget,
        worst.currency
      )} available).`,
      tone: 'warning',
    });
  }

  // 3. Historical monthly spending spike vs multi-month average (requires >= 2 months of data)
  if (expenses.monthlySeries.length >= 2) {
    const latestMonth = expenses.monthlySeries[expenses.monthlySeries.length - 1];
    const priorMonths = expenses.monthlySeries.slice(0, -1);
    const priorAvg =
      priorMonths.reduce((sum, m) => addDecimal(sum, m.amount), 0) / priorMonths.length;
    if (priorAvg > 0) {
      const diffPct = roundUnitPrice(((latestMonth.amount - priorAvg) / priorAvg) * 100);
      if (Math.abs(diffPct) >= 15) {
        insights.push({
          id: 'analytics_monthly_spending_shift',
          category: 'expense_trend',
          title: `${latestMonth.label} spending ${
            diffPct > 0 ? 'above' : 'below'
          } prior monthly average`,
          description: `${latestMonth.label} expenses (${fmt(latestMonth.amount)}) are ${Math.abs(
            diffPct
          ).toFixed(1)}% ${diffPct > 0 ? 'higher' : 'lower'} than the ${fmt(
            priorAvg
          )} average across the prior ${priorMonths.length} month(s).`,
          tone: diffPct > 0 ? 'warning' : 'positive',
        });
      }
    }
  }

  // 4. Savings rate observation (strictly requires Income > 0)
  if (!savings.hasZeroIncome && savings.savingsRatePct !== null) {
    insights.push({
      id: 'analytics_savings_rate',
      category: 'savings_rate',
      title: `Period savings rate: ${savings.savingsRatePct.toFixed(1)}%`,
      description:
        savings.totalSavings >= 0
          ? `Retained ${fmt(savings.totalSavings)} net savings from ${fmt(
              income.totalIncome
            )} total income.`
          : `Expenses exceeded income by ${fmt(Math.abs(savings.totalSavings))} in this period.`,
      tone:
        savings.savingsRatePct >= 20
          ? 'positive'
          : savings.savingsRatePct < 0
            ? 'warning'
            : 'neutral',
    });
  }

  // 5. Spending concentration or highest spending day (requires >= 2 expenses)
  if (
    spendingBehavior.sampleSize.isSufficientForBehavior &&
    spendingBehavior.highestSpendingDay
  ) {
    insights.push({
      id: 'analytics_highest_spending_day',
      category: 'largest_expense',
      title: `Peak spending day: ${formatDisplayDate(
        spendingBehavior.highestSpendingDay.date,
        dateFormat
      )}`,
      description: `${fmt(spendingBehavior.highestSpendingDay.amount)} spent across ${
        spendingBehavior.highestSpendingDay.transactionCount
      } expense(s), compared with an average daily pace of ${fmt(
        spendingBehavior.averageDailySpending
      )}/day.`,
      tone: 'neutral',
    });
  }

  // 6. Portfolio concentration (only when holdings exist)
  if (investments.byAssetClass.length > 0 && investments.holdingsMarketValue > 0) {
    const topClass = investments.byAssetClass[0];
    if (topClass.allocationPct >= 50) {
      insights.push({
        id: 'analytics_portfolio_concentration',
        category: 'investment_concentration',
        title: `Holdings concentrated in ${topClass.assetClassName}`,
        description: `${topClass.assetClassName} makes up ${topClass.allocationPct.toFixed(
          1
        )}% (${fmt(topClass.marketValue)}) of filtered holdings market value.`,
        tone: 'neutral',
      });
    }
  }

  // 7. Net Worth growth (strictly requires >= 2 valid checkpoints)
  if (
    netWorth.trend.hasSufficientData &&
    netWorth.periodGrowthAbs !== null &&
    netWorth.trend.points.length >= 2
  ) {
    const first = netWorth.trend.points[0];
    const last = netWorth.trend.points[netWorth.trend.points.length - 1];
    insights.push({
      id: 'analytics_net_worth_trajectory',
      category: 'net_worth_change',
      title: `Net Worth ${
        netWorth.periodGrowthAbs >= 0 ? 'increased' : 'decreased'
      } by ${fmt(Math.abs(netWorth.periodGrowthAbs))}`,
      description: `Moved from ${fmt(first.netWorth)} (${formatDisplayDate(
        first.date,
        dateFormat
      )}) to ${fmt(last.netWorth)} (${formatDisplayDate(last.date, dateFormat)}).`,
      tone:
        netWorth.periodGrowthAbs > 0
          ? 'positive'
          : netWorth.periodGrowthAbs < 0
            ? 'warning'
            : 'neutral',
    });
  }

  return insights;
}

export async function getAnalyticsSnapshot(
  options: AnalyticsFilterOptions = {}
): Promise<AnalyticsSnapshot> {
  const origin: RecordOrigin = options.recordOrigin ?? 'user';

  const [
    prefsList,
    accounts,
    categories,
    transactions,
    budgets,
    platforms,
    assetClasses,
    holdings,
    investmentActivities,
    valuations,
    investmentOverview,
    performanceHistory,
  ] = await Promise.all([
    preferencesRepository.getAll(),
    origin === 'test' ? accountsRepository.getTestRecords() : accountsRepository.getUserRecords(),
    origin === 'test' ? categoriesRepository.getTestRecords() : categoriesRepository.getUserRecords(),
    origin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    origin === 'test' ? budgetsRepository.getTestRecords() : budgetsRepository.getUserRecords(),
    origin === 'test'
      ? investmentPlatformsRepository.getTestRecords()
      : investmentPlatformsRepository.getUserRecords(),
    origin === 'test'
      ? assetClassesRepository.getTestRecords()
      : assetClassesRepository.getUserRecords(),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
    origin === 'test'
      ? portfolioValuationsRepository.getTestRecords()
      : portfolioValuationsRepository.getUserRecords(),
    getInvestmentOverviewSnapshot({
      recordOrigin: origin,
      baseCurrency: options.baseCurrency,
    }),
    getPortfolioPerformanceHistory({ recordOrigin: origin }),
  ]);

  const prefs = prefsList[0];
  const timezone = prefs?.timezone ?? APP_CONFIG.defaultTimezone;
  const numberFormat: NumberFormatPreference =
    prefs?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat: DateFormatPreference =
    prefs?.dateFormat ?? APP_CONFIG.defaultDateFormat;
  const manualFxRates = prefs?.manualFxRates ?? [];

  const context = resolveAnalyticsContext(options, {
    baseCurrency: prefs?.baseCurrency,
    timezone,
    firstDayOfWeek: prefs?.firstDayOfWeek,
  });

  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));
  const netWorthSnapshot = calculateConsolidatedNetWorth(
    sortedAccounts,
    transactions,
    investmentActivities,
    holdings
  );

  const income = computeIncomeAnalytics({
    transactions,
    accounts: sortedAccounts,
    categories,
    manualFxRates,
    context,
  });

  const expenses = computeExpenseAnalytics({
    transactions,
    accounts: sortedAccounts,
    categories,
    manualFxRates,
    context,
  });

  const spendingBehavior = computeSpendingBehavior({
    transactions,
    categories,
    manualFxRates,
    context,
    expenseAnalytics: expenses,
  });

  const savings = computeSavingsAnalytics({
    transactions,
    manualFxRates,
    context,
  });

  const investments = computeInvestmentAnalytics({
    investmentOverview,
    performanceHistory,
    manualFxRates,
    context,
  });

  const netWorth = computeNetWorthAnalytics({
    accounts: sortedAccounts,
    transactions,
    investmentActivities,
    holdings,
    valuations,
    netWorthSnapshot,
    investmentOverview,
    manualFxRates,
    context,
  });

  // Current active month budget evaluation for Health Indicator & Budget Insight
  const [todayY, todayM] = context.today.split('-').map(Number);
  const budgetEval = evaluateMonthlyBudgets({
    budgets,
    transactions,
    categories,
    manualFxRates,
    baseCurrency: context.baseCurrency,
    year: todayY,
    month: todayM,
    alertPreferences: prefs?.budgetAlertPreferences,
  });
  const budgetPeriodLabel = formatPeriodLabel(budgetEval.summary.periodKey);

  const periodLabel =
    context.dateRange.startDate && context.dateRange.endDate
      ? `${formatDisplayDate(context.dateRange.startDate, dateFormat)} – ${formatDisplayDate(
          context.dateRange.endDate,
          dateFormat
        )}`
      : 'Select a date range';

  const healthIndicators = buildFinancialHealthIndicators({
    baseCurrency: context.baseCurrency,
    numberFormat,
    savings,
    netWorth,
    budgetSummary: budgetEval.summary,
    budgetPeriodLabel,
    periodLabel,
  });

  const insights = generateAnalyticsInsights({
    baseCurrency: context.baseCurrency,
    numberFormat,
    dateFormat,
    income,
    expenses,
    spendingBehavior,
    savings,
    investments,
    netWorth,
    budgetEval,
    budgetPeriodLabel,
  });

  const excludedAll = Array.from(
    new Set([
      ...income.excludedCurrencies,
      ...expenses.excludedCurrencies,
      ...savings.excludedCurrencies,
      ...investments.excludedCurrencies,
      ...netWorth.excludedCurrencies,
    ])
  ).sort();

  return {
    generatedAt: nowIso(),
    context,
    timezone,
    numberFormat,
    dateFormat,
    overview: {
      currency: context.baseCurrency,
      totalIncome: income.totalIncome,
      totalExpenses: expenses.totalExpenses,
      netSavings: savings.totalSavings,
      savingsRatePct: savings.savingsRatePct,
      expenseToIncomeRatioPct: savings.expenseToIncomeRatioPct,
      netWorth: netWorth.currentNetWorth,
      investmentValue: investments.totalInvestmentValue,
      availableCash: netWorth.availableCash,
      currentMonthBudgetUtilizationPct: budgetEval.summary.utilizationPct,
    },
    income,
    expenses,
    spendingBehavior,
    savings,
    investments,
    netWorth,
    healthIndicators,
    insights,
    filterOptions: {
      accounts: sortedAccounts.filter((a) => !a.isArchived),
      categories: [...categories]
        .filter((c) => !c.isArchived && (c.kind === 'income' || c.kind === 'expense'))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      platforms: [...platforms]
        .filter((p) => !p.isArchived)
        .sort((a, b) => a.name.localeCompare(b.name)),
      assetClasses: [...assetClasses]
        .filter((ac) => !ac.isArchived)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      holdings: [...holdings]
        .filter((h) => !h.isArchived)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    },
    manualFxRates,
    excludedCurrencies: excludedAll,
  };
}

export function subscribeToAnalyticsChanges(onChange: () => void): () => void {
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
          db.budgets.count(),
          db.investmentPlatforms.count(),
          db.assetClasses.count(),
          db.holdings.count(),
          db.investmentActivities.count(),
          db.portfolioValuations.count(),
          db.preferences.count(),
        ]);
        const [latestTx, latestAct, latestHold, latestBudget, latestPref] =
          await Promise.all([
            db.transactions.orderBy('updatedAt').last(),
            db.investmentActivities.orderBy('updatedAt').last(),
            db.holdings.orderBy('updatedAt').last(),
            db.budgets.orderBy('updatedAt').last(),
            db.preferences.toCollection().first(),
          ]);
        return [
          ...counts,
          latestTx?.updatedAt ?? '',
          latestAct?.updatedAt ?? '',
          latestHold?.updatedAt ?? '',
          latestBudget?.updatedAt ?? '',
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
          // Safe fallback
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
