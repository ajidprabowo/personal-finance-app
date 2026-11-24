import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { isDateWithinRange, type DateRange } from '@/lib/dates';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import type {
  Budget,
  BudgetAlertPreferences,
  Category,
  ManualFxRateEntry,
  Transaction,
} from '@/types/entities';

export type BudgetHealthStatus = 'on_track' | 'near_limit' | 'over_budget';

export const DEFAULT_BUDGET_ALERT_PREFERENCES: BudgetAlertPreferences = {
  nearLimitThresholdPct: 80,
  overBudgetThresholdPct: 100,
  enableNearLimitAlerts: true,
  enableFullLimitAlerts: true,
  enableOverBudgetAlerts: true,
};

export function padMonth(month: number): string {
  return String(month).padStart(2, '0');
}

export function buildPeriodKey(year: number, month: number): string {
  return `${year}-${padMonth(month)}`;
}

export function parsePeriodKey(periodKey: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey.trim());
  if (!match) {
    throw new Error(`Invalid budget period key "${periodKey}". Expected YYYY-MM.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month "${month}" in period key "${periodKey}".`);
  }
  return { year, month };
}

export function shiftPeriodMonth(
  year: number,
  month: number,
  deltaMonths: number
): { year: number; month: number; periodKey: string } {
  const zeroIndexed = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroIndexed / 12);
  const nextMonth = ((zeroIndexed % 12) + 12) % 12 + 1;
  return {
    year: nextYear,
    month: nextMonth,
    periodKey: buildPeriodKey(nextYear, nextMonth),
  };
}

export function getMonthDateBounds(year: number, month: number): DateRange & {
  startDate: string;
  endDate: string;
} {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${year}-${padMonth(month)}-01`,
    endDate: `${year}-${padMonth(month)}-${padMonth(lastDay)}`,
  };
}

export function formatPeriodLabel(periodKey: string): string {
  const { year, month } = parsePeriodKey(periodKey);
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${names[month - 1] ?? month} ${year}`;
}

export function getBudgetPeriodKey(budget: Budget): string {
  if (budget.periodKey && /^\d{4}-\d{2}$/.test(budget.periodKey)) {
    return budget.periodKey;
  }
  return buildPeriodKey(budget.year, budget.month ?? 1);
}

export function getBudgetDateRange(budget: Budget): { startDate: string; endDate: string } {
  if (budget.startDate && budget.endDate) {
    return { startDate: budget.startDate, endDate: budget.endDate };
  }
  const periodKey = getBudgetPeriodKey(budget);
  const { year, month } = parsePeriodKey(periodKey);
  const bounds = getMonthDateBounds(year, month);
  return { startDate: bounds.startDate, endDate: bounds.endDate };
}

export function isEligibleBudgetExpenseTransaction(tx: Transaction): boolean {
  // Strictly count real expense transactions only; exclude income, internal transfers, and investment settlements
  if (tx.type !== 'expense') return false;
  if (tx.transferGroupId) return false;
  if (tx.relatedInvestmentActivityId) return false;
  const amount = Number.isFinite(tx.amount) ? tx.amount : 0;
  return amount > 0;
}

export interface ComputedBudgetItem {
  budget: Budget;
  periodKey: string;
  categoryId: string;
  categoryName: string;
  categoryArchived: boolean;
  categoryMissing: boolean;
  isActive: boolean;
  currency: string;
  baseLimit: number;
  rolloverAmount: number;
  availableBudget: number;
  actualAmount: number;
  remainingAmount: number;
  utilizationPct: number | null;
  status: BudgetHealthStatus;
  transactionCount: number;
  unconvertedCurrencies: string[];
  // Converted to baseCurrency (null if manual FX rate missing)
  convertedAvailableBudget: number | null;
  convertedBaseLimit: number | null;
  convertedRolloverAmount: number | null;
  convertedActualAmount: number | null;
  convertedRemainingAmount: number | null;
}

export interface UnbudgetedExpenseCategoryItem {
  categoryId: string;
  categoryName: string;
  currency: string;
  actualAmount: number;
  convertedActualAmount: number | null;
  transactionCount: number;
}

export interface MonthlyBudgetSummaryMetrics {
  periodKey: string;
  year: number;
  month: number;
  baseCurrency: string;
  totalBudget: number;
  totalBaseLimit: number;
  totalRollover: number;
  totalActualBudgetedExpenses: number;
  totalAllMonthExpenses: number;
  remainingBudget: number;
  utilizationPct: number | null;
  activeBudgetCount: number;
  inactiveBudgetCount: number;
  overBudgetCount: number;
  nearLimitCount: number;
  onTrackCount: number;
  excludedCurrencies: string[];
}

export interface EvaluateBudgetsParams {
  budgets: Budget[];
  transactions: Transaction[];
  categories: Category[];
  manualFxRates: ManualFxRateEntry[];
  baseCurrency: string;
  year: number;
  month: number;
  alertPreferences?: BudgetAlertPreferences;
}

export interface EvaluateBudgetsResult {
  summary: MonthlyBudgetSummaryMetrics;
  items: ComputedBudgetItem[];
  inactiveItems: ComputedBudgetItem[];
  unbudgetedCategories: UnbudgetedExpenseCategoryItem[];
}

function convertValue(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  manualFxRates: ManualFxRateEntry[]
): number | null {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return roundCurrencyAmount(amount, to);
  const rate = findManualFxRate(manualFxRates, from, to);
  if (!rate) return null;
  return convertCurrencyWithManualRate(amount, from, to, rate).convertedAmount;
}

export function resolveBudgetStatus(
  availableBudget: number,
  actualAmount: number,
  alertPreferences: BudgetAlertPreferences = DEFAULT_BUDGET_ALERT_PREFERENCES
): { status: BudgetHealthStatus; utilizationPct: number | null } {
  if (availableBudget <= 0) {
    if (actualAmount > 0) {
      return { status: 'over_budget', utilizationPct: null };
    }
    return { status: 'on_track', utilizationPct: 0 };
  }

  const utilizationPct = roundUnitPrice((actualAmount / availableBudget) * 100);
  if (utilizationPct > alertPreferences.overBudgetThresholdPct) {
    return { status: 'over_budget', utilizationPct };
  }
  if (utilizationPct >= alertPreferences.nearLimitThresholdPct) {
    return { status: 'near_limit', utilizationPct };
  }
  return { status: 'on_track', utilizationPct };
}

export function evaluateMonthlyBudgets(params: EvaluateBudgetsParams): EvaluateBudgetsResult {
  const baseCurrency = (params.baseCurrency || APP_CONFIG.defaultCurrency).toUpperCase();
  const periodKey = buildPeriodKey(params.year, params.month);
  const bounds = getMonthDateBounds(params.year, params.month);
  const alertPrefs = params.alertPreferences ?? DEFAULT_BUDGET_ALERT_PREFERENCES;
  const categoryMap = new Map(params.categories.map((c) => [c.id, c]));

  const monthExpenseTxs = params.transactions.filter(
    (tx) => isEligibleBudgetExpenseTransaction(tx) && isDateWithinRange(tx.date, bounds)
  );

  const periodBudgets = params.budgets.filter((b) => getBudgetPeriodKey(b) === periodKey);

  const computedAll: ComputedBudgetItem[] = [];
  const activeBudgetCategoryKeys = new Set<string>();
  const excludedCurrencySet = new Set<string>();

  for (const budget of periodBudgets) {
    const budgetCurrency = (budget.currency || baseCurrency).toUpperCase();
    const isActive = budget.isActive !== false;
    const cat = categoryMap.get(budget.categoryId);
    const categoryName =
      cat?.name ?? budget.categoryNameSnapshot ?? 'Deleted Category';
    const categoryArchived = cat?.isArchived ?? false;
    const categoryMissing = !cat;

    const range = getBudgetDateRange(budget);
    const matchingTxs = monthExpenseTxs.filter(
      (tx) => tx.categoryId === budget.categoryId && isDateWithinRange(tx.date, range)
    );

    let actualAmount = 0;
    let txCount = 0;
    const unconvertedTxCurrencies = new Set<string>();

    for (const tx of matchingTxs) {
      const txCurrency = (tx.currency || budgetCurrency).toUpperCase();
      if (txCurrency === budgetCurrency) {
        actualAmount = roundCurrencyAmount(addDecimal(actualAmount, tx.amount), budgetCurrency);
        txCount += 1;
      } else {
        const conv = convertValue(tx.amount, txCurrency, budgetCurrency, params.manualFxRates);
        if (conv !== null) {
          actualAmount = roundCurrencyAmount(addDecimal(actualAmount, conv), budgetCurrency);
          txCount += 1;
        } else {
          unconvertedTxCurrencies.add(txCurrency);
        }
      }
    }

    const baseLimit = roundCurrencyAmount(Math.max(0, budget.limitAmount), budgetCurrency);
    const rolloverAmount = roundCurrencyAmount(
      Math.max(0, budget.rolloverAmount ?? 0),
      budgetCurrency
    );
    const availableBudget = roundCurrencyAmount(
      addDecimal(baseLimit, rolloverAmount),
      budgetCurrency
    );
    const remainingAmount = roundCurrencyAmount(
      subtractDecimal(availableBudget, actualAmount),
      budgetCurrency
    );

    const { status, utilizationPct } = resolveBudgetStatus(
      availableBudget,
      actualAmount,
      alertPrefs
    );

    const convertedBaseLimit = convertValue(
      baseLimit,
      budgetCurrency,
      baseCurrency,
      params.manualFxRates
    );
    const convertedRolloverAmount = convertValue(
      rolloverAmount,
      budgetCurrency,
      baseCurrency,
      params.manualFxRates
    );
    const convertedAvailableBudget = convertValue(
      availableBudget,
      budgetCurrency,
      baseCurrency,
      params.manualFxRates
    );
    const convertedActualAmount = convertValue(
      actualAmount,
      budgetCurrency,
      baseCurrency,
      params.manualFxRates
    );
    const convertedRemainingAmount =
      convertedAvailableBudget !== null && convertedActualAmount !== null
        ? roundCurrencyAmount(
            subtractDecimal(convertedAvailableBudget, convertedActualAmount),
            baseCurrency
          )
        : null;

    if (isActive && convertedAvailableBudget === null) {
      excludedCurrencySet.add(budgetCurrency);
    }

    if (isActive) {
      activeBudgetCategoryKeys.add(budget.categoryId);
    }

    computedAll.push({
      budget,
      periodKey,
      categoryId: budget.categoryId,
      categoryName,
      categoryArchived,
      categoryMissing,
      isActive,
      currency: budgetCurrency,
      baseLimit,
      rolloverAmount,
      availableBudget,
      actualAmount,
      remainingAmount,
      utilizationPct,
      status,
      transactionCount: txCount,
      unconvertedCurrencies: Array.from(unconvertedTxCurrencies).sort(),
      convertedAvailableBudget,
      convertedBaseLimit,
      convertedRolloverAmount,
      convertedActualAmount,
      convertedRemainingAmount,
    });
  }

  const items = computedAll.filter((item) => item.isActive);
  const inactiveItems = computedAll.filter((item) => !item.isActive);

  let totalBudget = 0;
  let totalBaseLimit = 0;
  let totalRollover = 0;
  let totalActualBudgetedExpenses = 0;
  let overBudgetCount = 0;
  let nearLimitCount = 0;
  let onTrackCount = 0;

  for (const item of items) {
    if (item.convertedAvailableBudget !== null) {
      totalBudget = roundCurrencyAmount(
        addDecimal(totalBudget, item.convertedAvailableBudget),
        baseCurrency
      );
    }
    if (item.convertedBaseLimit !== null) {
      totalBaseLimit = roundCurrencyAmount(
        addDecimal(totalBaseLimit, item.convertedBaseLimit),
        baseCurrency
      );
    }
    if (item.convertedRolloverAmount !== null) {
      totalRollover = roundCurrencyAmount(
        addDecimal(totalRollover, item.convertedRolloverAmount),
        baseCurrency
      );
    }
    if (item.convertedActualAmount !== null) {
      totalActualBudgetedExpenses = roundCurrencyAmount(
        addDecimal(totalActualBudgetedExpenses, item.convertedActualAmount),
        baseCurrency
      );
    }

    if (item.status === 'over_budget') overBudgetCount += 1;
    else if (item.status === 'near_limit') nearLimitCount += 1;
    else onTrackCount += 1;
  }

  // Total all expenses in the month (including unbudgeted categories)
  let totalAllMonthExpenses = 0;
  const unbudgetedMap = new Map<
    string,
    { categoryId: string; categoryName: string; currency: string; amount: number; count: number }
  >();

  for (const tx of monthExpenseTxs) {
    const txCurrency = (tx.currency || baseCurrency).toUpperCase();
    const conv = convertValue(tx.amount, txCurrency, baseCurrency, params.manualFxRates);
    if (conv !== null) {
      totalAllMonthExpenses = roundCurrencyAmount(
        addDecimal(totalAllMonthExpenses, conv),
        baseCurrency
      );
    } else {
      excludedCurrencySet.add(txCurrency);
    }

    const catId = tx.categoryId || 'uncategorized';
    if (!activeBudgetCategoryKeys.has(catId)) {
      const cat = categoryMap.get(catId);
      const mapKey = `${catId}:${txCurrency}`;
      const existing = unbudgetedMap.get(mapKey) ?? {
        categoryId: catId,
        categoryName: cat?.name ?? 'Uncategorized',
        currency: txCurrency,
        amount: 0,
        count: 0,
      };
      existing.amount = roundCurrencyAmount(addDecimal(existing.amount, tx.amount), txCurrency);
      existing.count += 1;
      unbudgetedMap.set(mapKey, existing);
    }
  }

  const unbudgetedCategories: UnbudgetedExpenseCategoryItem[] = Array.from(
    unbudgetedMap.values()
  )
    .map((entry) => ({
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      currency: entry.currency,
      actualAmount: entry.amount,
      convertedActualAmount: convertValue(
        entry.amount,
        entry.currency,
        baseCurrency,
        params.manualFxRates
      ),
      transactionCount: entry.count,
    }))
    .sort((a, b) => (b.convertedActualAmount ?? b.actualAmount) - (a.convertedActualAmount ?? a.actualAmount));

  const remainingBudget = roundCurrencyAmount(
    subtractDecimal(totalBudget, totalActualBudgetedExpenses),
    baseCurrency
  );
  const utilizationPct =
    totalBudget > 0 ? roundUnitPrice((totalActualBudgetedExpenses / totalBudget) * 100) : null;

  return {
    summary: {
      periodKey,
      year: params.year,
      month: params.month,
      baseCurrency,
      totalBudget,
      totalBaseLimit,
      totalRollover,
      totalActualBudgetedExpenses,
      totalAllMonthExpenses,
      remainingBudget,
      utilizationPct,
      activeBudgetCount: items.length,
      inactiveBudgetCount: inactiveItems.length,
      overBudgetCount,
      nearLimitCount,
      onTrackCount,
      excludedCurrencies: Array.from(excludedCurrencySet).sort(),
    },
    items,
    inactiveItems,
    unbudgetedCategories,
  };
}
