import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  convertAnalyticsAmount,
  countMonthsInAnalyticsSpan,
  formatAnalyticsBucketLabel,
  matchesAnalyticsTransactionFilters,
  type ResolvedAnalyticsContext,
} from '@/services/analytics-filter.service';
import type { ManualFxRateEntry, Transaction } from '@/types/entities';

export interface MonthlySavingsPoint {
  monthKey: string;
  label: string;
  income: number;
  expenses: number;
  savings: number;
  savingsRatePct: number | null;
  expenseToIncomeRatioPct: number | null;
  isIncompletePeriod: boolean;
}

export interface SavingsAnalyticsResult {
  currency: string;
  totalIncome: number;
  totalExpenses: number;
  totalSavings: number;
  savingsRatePct: number | null;
  expenseToIncomeRatioPct: number | null;
  averageMonthlySavings: number;
  monthCount: number;
  hasZeroIncome: boolean;
  hasNegativeSavings: boolean;
  incompletePeriodIncluded: boolean;
  monthlyTrend: MonthlySavingsPoint[];
  excludedCurrencies: string[];
}

export function computeSavingsAnalytics(params: {
  transactions: Transaction[];
  manualFxRates: ManualFxRateEntry[];
  context: ResolvedAnalyticsContext;
}): SavingsAnalyticsResult {
  const { transactions, manualFxRates, context } = params;
  const baseCurrency = context.baseCurrency;
  const excludedSet = new Set<string>();
  const currentMonthKey = context.today.slice(0, 7);

  // Respect account & category filters if set, while always evaluating income & expense streams
  const filterCtx = {
    accountId: context.accountId,
    categoryId: context.categoryId,
    transactionType: 'all' as const,
  };

  const filteredTxs = transactions.filter((tx) =>
    matchesAnalyticsTransactionFilters(tx, filterCtx, context.dateRange)
  );

  let totalIncome = 0;
  let totalExpenses = 0;
  const monthlyMap = new Map<string, { income: number; expenses: number }>();

  for (const tx of filteredTxs) {
    const converted = convertAnalyticsAmount(
      tx.amount,
      tx.currency,
      baseCurrency,
      manualFxRates,
      excludedSet,
      tx.date
    );
    if (converted === null) continue;

    const monthKey = tx.date.slice(0, 7);
    const bucket = monthlyMap.get(monthKey) ?? { income: 0, expenses: 0 };

    if (tx.type === 'income') {
      totalIncome = roundCurrencyAmount(addDecimal(totalIncome, converted), baseCurrency);
      bucket.income = roundCurrencyAmount(addDecimal(bucket.income, converted), baseCurrency);
    } else if (tx.type === 'expense') {
      totalExpenses = roundCurrencyAmount(addDecimal(totalExpenses, converted), baseCurrency);
      bucket.expenses = roundCurrencyAmount(addDecimal(bucket.expenses, converted), baseCurrency);
    }

    monthlyMap.set(monthKey, bucket);
  }

  const totalSavings = roundCurrencyAmount(
    subtractDecimal(totalIncome, totalExpenses),
    baseCurrency
  );
  const savingsRatePct =
    totalIncome > 0 ? roundUnitPrice((totalSavings / totalIncome) * 100) : null;
  const expenseToIncomeRatioPct =
    totalIncome > 0 ? roundUnitPrice((totalExpenses / totalIncome) * 100) : null;

  const monthCount = countMonthsInAnalyticsSpan(
    context.dateRange,
    filteredTxs,
    context.today
  );
  const averageMonthlySavings =
    monthCount > 0 ? roundCurrencyAmount(totalSavings / monthCount, baseCurrency) : 0;

  let incompletePeriodIncluded = false;
  const monthlyTrend: MonthlySavingsPoint[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, vals]) => {
      const savings = roundCurrencyAmount(
        subtractDecimal(vals.income, vals.expenses),
        baseCurrency
      );
      const isIncompletePeriod = monthKey >= currentMonthKey;
      if (isIncompletePeriod) incompletePeriodIncluded = true;
      return {
        monthKey,
        label: formatAnalyticsBucketLabel(monthKey, 'monthly'),
        income: vals.income,
        expenses: vals.expenses,
        savings,
        savingsRatePct:
          vals.income > 0 ? roundUnitPrice((savings / vals.income) * 100) : null,
        expenseToIncomeRatioPct:
          vals.income > 0 ? roundUnitPrice((vals.expenses / vals.income) * 100) : null,
        isIncompletePeriod,
      };
    });

  return {
    currency: baseCurrency,
    totalIncome,
    totalExpenses,
    totalSavings,
    savingsRatePct,
    expenseToIncomeRatioPct,
    averageMonthlySavings,
    monthCount,
    hasZeroIncome: totalIncome <= 0,
    hasNegativeSavings: totalSavings < 0,
    incompletePeriodIncluded,
    monthlyTrend,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
