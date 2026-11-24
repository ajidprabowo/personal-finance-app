import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, roundUnitPrice } from '@/lib/precision';
import {
  convertAnalyticsAmount,
  countSpanDaysInAnalyticsRange,
  matchesAnalyticsTransactionFilters,
  type ResolvedAnalyticsContext,
} from '@/services/analytics-filter.service';
import type { ExpenseAnalyticsResult, LargestExpenseRecord } from '@/services/expense-analytics.service';
import type {
  Category,
  ManualFxRateEntry,
  Transaction,
} from '@/types/entities';

export interface RecurringSpendingCandidate {
  merchantOrDescription: string;
  categoryName: string;
  occurrences: number;
  distinctMonths: number;
  averageAmount: number;
  totalAmount: number;
  currency: string;
}

export interface SpendingBehaviorResult {
  currency: string;
  highestSpendingCategory: {
    categoryId: string;
    categoryName: string;
    amount: number;
    percentageOfTotal: number;
    transactionCount: number;
  } | null;
  mostFrequentCategory: {
    categoryId: string;
    categoryName: string;
    transactionCount: number;
    amount: number;
  } | null;
  highestSpendingDay: {
    date: string;
    amount: number;
    transactionCount: number;
  } | null;
  largestExpenseTransaction: LargestExpenseRecord | null;
  averageDailySpending: number;
  averageTransactionSize: number;
  topCategoryConcentrationPct: number | null;
  top3CategoryConcentrationPct: number | null;
  weekdayVsWeekend: {
    weekdayTotal: number;
    weekdayCount: number;
    weekdaySharePct: number;
    weekendTotal: number;
    weekendCount: number;
    weekendSharePct: number;
  };
  recurringCandidates: RecurringSpendingCandidate[];
  sampleSize: {
    expenseCount: number;
    activeDayCount: number;
    spanDays: number;
    isSufficientForBehavior: boolean;
  };
  excludedCurrencies: string[];
}

function isWeekendIsoDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return utcDay === 0 || utcDay === 6;
}

export function computeSpendingBehavior(params: {
  transactions: Transaction[];
  categories: Category[];
  manualFxRates: ManualFxRateEntry[];
  context: ResolvedAnalyticsContext;
  expenseAnalytics: ExpenseAnalyticsResult;
}): SpendingBehaviorResult {
  const { transactions, categories, manualFxRates, context, expenseAnalytics } = params;
  const baseCurrency = context.baseCurrency;
  const excludedSet = new Set<string>(expenseAnalytics.excludedCurrencies);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const currentExpenseTxs = transactions.filter(
    (tx) =>
      tx.type === 'expense' &&
      matchesAnalyticsTransactionFilters(tx, context, context.dateRange)
  );

  const dayTotals = new Map<string, { amount: number; count: number }>();
  const merchantGroups = new Map<
    string,
    {
      label: string;
      categoryName: string;
      amounts: number[];
      months: Set<string>;
      total: number;
    }
  >();

  let weekdayTotal = 0;
  let weekdayCount = 0;
  let weekendTotal = 0;
  let weekendCount = 0;
  let validExpenseCount = 0;

  for (const tx of currentExpenseTxs) {
    const converted = convertAnalyticsAmount(
      tx.amount,
      tx.currency,
      baseCurrency,
      manualFxRates,
      excludedSet,
      tx.date
    );
    if (converted === null) continue;

    validExpenseCount += 1;

    const d = dayTotals.get(tx.date) ?? { amount: 0, count: 0 };
    d.amount = roundCurrencyAmount(addDecimal(d.amount, converted), baseCurrency);
    d.count += 1;
    dayTotals.set(tx.date, d);

    if (isWeekendIsoDate(tx.date)) {
      weekendTotal = roundCurrencyAmount(addDecimal(weekendTotal, converted), baseCurrency);
      weekendCount += 1;
    } else {
      weekdayTotal = roundCurrencyAmount(addDecimal(weekdayTotal, converted), baseCurrency);
      weekdayCount += 1;
    }

    const label = (tx.merchant || tx.description || '').trim();
    const normKey = label.toLowerCase().replace(/\s+/g, ' ');
    if (normKey) {
      const catName =
        categoryMap.get(tx.categoryId || '')?.name ?? 'Uncategorized';
      const entry = merchantGroups.get(normKey) ?? {
        label,
        categoryName: catName,
        amounts: [],
        months: new Set<string>(),
        total: 0,
      };
      entry.amounts.push(converted);
      entry.months.add(tx.date.slice(0, 7));
      entry.total = roundCurrencyAmount(addDecimal(entry.total, converted), baseCurrency);
      merchantGroups.set(normKey, entry);
    }
  }

  let highestSpendingDay: SpendingBehaviorResult['highestSpendingDay'] = null;
  for (const [date, info] of dayTotals.entries()) {
    if (!highestSpendingDay || info.amount > highestSpendingDay.amount) {
      highestSpendingDay = {
        date,
        amount: info.amount,
        transactionCount: info.count,
      };
    }
  }

  const byCat = expenseAnalytics.byCategory;
  const highestSpendingCategory =
    byCat.length > 0
      ? {
          categoryId: byCat[0].categoryId,
          categoryName: byCat[0].categoryName,
          amount: byCat[0].amount,
          percentageOfTotal: byCat[0].percentageOfTotal,
          transactionCount: byCat[0].transactionCount,
        }
      : null;

  const mostFrequentSorted = [...byCat].sort(
    (a, b) => b.transactionCount - a.transactionCount || b.amount - a.amount
  );
  const mostFrequentCategory =
    mostFrequentSorted.length > 0
      ? {
          categoryId: mostFrequentSorted[0].categoryId,
          categoryName: mostFrequentSorted[0].categoryName,
          transactionCount: mostFrequentSorted[0].transactionCount,
          amount: mostFrequentSorted[0].amount,
        }
      : null;

  const spanDays = countSpanDaysInAnalyticsRange(
    context.dateRange,
    currentExpenseTxs,
    context.today
  );
  const averageDailySpending =
    spanDays > 0 && expenseAnalytics.totalExpenses > 0
      ? roundCurrencyAmount(expenseAnalytics.totalExpenses / spanDays, baseCurrency)
      : 0;
  const averageTransactionSize =
    validExpenseCount > 0
      ? roundCurrencyAmount(expenseAnalytics.totalExpenses / validExpenseCount, baseCurrency)
      : 0;

  const topCategoryConcentrationPct =
    byCat.length > 0 && expenseAnalytics.totalExpenses > 0
      ? byCat[0].percentageOfTotal
      : null;
  const top3Sum = byCat.slice(0, 3).reduce((sum, item) => addDecimal(sum, item.amount), 0);
  const top3CategoryConcentrationPct =
    byCat.length > 0 && expenseAnalytics.totalExpenses > 0
      ? roundUnitPrice((top3Sum / expenseAnalytics.totalExpenses) * 100)
      : null;

  const combinedWeekTotal = addDecimal(weekdayTotal, weekendTotal);
  const weekdaySharePct =
    combinedWeekTotal > 0 ? roundUnitPrice((weekdayTotal / combinedWeekTotal) * 100) : 0;
  const weekendSharePct =
    combinedWeekTotal > 0 ? roundUnitPrice((weekendTotal / combinedWeekTotal) * 100) : 0;

  // Deterministic recurring expense detection: strictly >= 2 distinct months & consistent amount (<= 25% spread) or explicit recurring category
  const recurringCandidates: RecurringSpendingCandidate[] = [];
  for (const group of merchantGroups.values()) {
    if (group.months.size < 2 || group.amounts.length < 2) continue;
    const avg = group.total / group.amounts.length;
    const min = Math.min(...group.amounts);
    const max = Math.max(...group.amounts);
    const spreadRatio = avg > 0 ? (max - min) / avg : 1;
    if (spreadRatio <= 0.35 || group.categoryName.toLowerCase().includes('subscription')) {
      recurringCandidates.push({
        merchantOrDescription: group.label,
        categoryName: group.categoryName,
        occurrences: group.amounts.length,
        distinctMonths: group.months.size,
        averageAmount: roundCurrencyAmount(avg, baseCurrency),
        totalAmount: group.total,
        currency: baseCurrency,
      });
    }
  }
  recurringCandidates.sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    currency: baseCurrency,
    highestSpendingCategory,
    mostFrequentCategory,
    highestSpendingDay,
    largestExpenseTransaction: expenseAnalytics.largestTransaction,
    averageDailySpending,
    averageTransactionSize,
    topCategoryConcentrationPct,
    top3CategoryConcentrationPct,
    weekdayVsWeekend: {
      weekdayTotal,
      weekdayCount,
      weekdaySharePct,
      weekendTotal,
      weekendCount,
      weekendSharePct,
    },
    recurringCandidates: recurringCandidates.slice(0, 6),
    sampleSize: {
      expenseCount: validExpenseCount,
      activeDayCount: dayTotals.size,
      spanDays,
      isSufficientForBehavior: validExpenseCount >= 2,
    },
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
