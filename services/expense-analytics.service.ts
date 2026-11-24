import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  convertAnalyticsAmount,
  countMonthsInAnalyticsSpan,
  formatAnalyticsBucketLabel,
  getAnalyticsBucketKey,
  matchesAnalyticsTransactionFilters,
  type ResolvedAnalyticsContext,
} from '@/services/analytics-filter.service';
import type {
  Account,
  Category,
  ManualFxRateEntry,
  Transaction,
} from '@/types/entities';

export interface ExpenseTrendPoint {
  bucketKey: string;
  label: string;
  amount: number;
  transactionCount: number;
}

export interface ExpenseCategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  amount: number;
  previousAmount: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  percentageOfTotal: number;
  transactionCount: number;
}

export interface ExpenseAccountBreakdownItem {
  accountId: string;
  accountName: string;
  amount: number;
  percentageOfTotal: number;
  transactionCount: number;
}

export interface LargestExpenseRecord {
  id: string;
  date: string;
  description: string;
  categoryName: string;
  accountName: string;
  amount: number;
  currency: string;
  convertedAmount: number;
}

export interface ExpenseAnalyticsResult {
  currency: string;
  totalExpenses: number;
  previousExpenses: number | null;
  expenseChangeAbs: number | null;
  expenseChangePct: number | null;
  averageMonthlyExpenses: number;
  monthCount: number;
  transactionCount: number;
  largestTransaction: LargestExpenseRecord | null;
  trendSeries: ExpenseTrendPoint[];
  monthlySeries: ExpenseTrendPoint[];
  dailySeries: ExpenseTrendPoint[];
  byCategory: ExpenseCategoryBreakdownItem[];
  byAccount: ExpenseAccountBreakdownItem[];
  excludedCurrencies: string[];
}

export function computeExpenseAnalytics(params: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  manualFxRates: ManualFxRateEntry[];
  context: ResolvedAnalyticsContext;
}): ExpenseAnalyticsResult {
  const { transactions, accounts, categories, manualFxRates, context } = params;
  const baseCurrency = context.baseCurrency;
  const excludedSet = new Set<string>();

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const currentExpenseTxs = transactions.filter(
    (tx) =>
      tx.type === 'expense' &&
      matchesAnalyticsTransactionFilters(tx, context, context.dateRange)
  );

  const previousExpenseTxs = context.previousDateRange
    ? transactions.filter(
        (tx) =>
          tx.type === 'expense' &&
          matchesAnalyticsTransactionFilters(tx, context, context.previousDateRange!)
      )
    : [];

  let totalExpenses = 0;
  let transactionCount = 0;
  let largestTransaction: LargestExpenseRecord | null = null;

  const bucketMap = new Map<string, { amount: number; count: number }>();
  const monthlyMap = new Map<string, { amount: number; count: number }>();
  const dailyMap = new Map<string, { amount: number; count: number }>();
  const catMap = new Map<string, { amount: number; count: number }>();
  const accMap = new Map<string, { amount: number; count: number }>();

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

    transactionCount += 1;
    totalExpenses = roundCurrencyAmount(addDecimal(totalExpenses, converted), baseCurrency);

    const bKey = getAnalyticsBucketKey(tx.date, context.interval, context.firstDayOfWeek);
    const b = bucketMap.get(bKey) ?? { amount: 0, count: 0 };
    b.amount = roundCurrencyAmount(addDecimal(b.amount, converted), baseCurrency);
    b.count += 1;
    bucketMap.set(bKey, b);

    const mKey = tx.date.slice(0, 7);
    const m = monthlyMap.get(mKey) ?? { amount: 0, count: 0 };
    m.amount = roundCurrencyAmount(addDecimal(m.amount, converted), baseCurrency);
    m.count += 1;
    monthlyMap.set(mKey, m);

    const d = dailyMap.get(tx.date) ?? { amount: 0, count: 0 };
    d.amount = roundCurrencyAmount(addDecimal(d.amount, converted), baseCurrency);
    d.count += 1;
    dailyMap.set(tx.date, d);

    const catId = tx.categoryId || 'uncategorized';
    const cat = catMap.get(catId) ?? { amount: 0, count: 0 };
    cat.amount = roundCurrencyAmount(addDecimal(cat.amount, converted), baseCurrency);
    cat.count += 1;
    catMap.set(catId, cat);

    const acc = accMap.get(tx.accountId) ?? { amount: 0, count: 0 };
    acc.amount = roundCurrencyAmount(addDecimal(acc.amount, converted), baseCurrency);
    acc.count += 1;
    accMap.set(tx.accountId, acc);

    if (!largestTransaction || converted > largestTransaction.convertedAmount) {
      largestTransaction = {
        id: tx.id,
        date: tx.date,
        description: tx.description,
        categoryName: categoryMap.get(catId)?.name ?? 'Uncategorized',
        accountName: accountMap.get(tx.accountId)?.name ?? 'Unknown Account',
        amount: tx.amount,
        currency: tx.currency.toUpperCase(),
        convertedAmount: converted,
      };
    }
  }

  let previousExpenses: number | null = context.previousDateRange ? 0 : null;
  const prevCatMap = new Map<string, number>();

  if (previousExpenses !== null) {
    for (const tx of previousExpenseTxs) {
      const converted = convertAnalyticsAmount(
        tx.amount,
        tx.currency,
        baseCurrency,
        manualFxRates,
        excludedSet,
        tx.date
      );
      if (converted === null) continue;
      previousExpenses = roundCurrencyAmount(addDecimal(previousExpenses, converted), baseCurrency);
      const catId = tx.categoryId || 'uncategorized';
      prevCatMap.set(
        catId,
        roundCurrencyAmount(addDecimal(prevCatMap.get(catId) ?? 0, converted), baseCurrency)
      );
    }
  }

  const expenseChangeAbs =
    previousExpenses !== null
      ? roundCurrencyAmount(subtractDecimal(totalExpenses, previousExpenses), baseCurrency)
      : null;
  const expenseChangePct =
    previousExpenses !== null && previousExpenses > 0 && expenseChangeAbs !== null
      ? roundUnitPrice((expenseChangeAbs / previousExpenses) * 100)
      : null;

  const monthCount = countMonthsInAnalyticsSpan(
    context.dateRange,
    currentExpenseTxs,
    context.today
  );
  const averageMonthlyExpenses =
    monthCount > 0 ? roundCurrencyAmount(totalExpenses / monthCount, baseCurrency) : 0;

  const toSeries = (
    map: Map<string, { amount: number; count: number }>,
    interval: 'daily' | 'weekly' | 'monthly'
  ): ExpenseTrendPoint[] =>
    Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucketKey, data]) => ({
        bucketKey,
        label: formatAnalyticsBucketLabel(bucketKey, interval),
        amount: data.amount,
        transactionCount: data.count,
      }));

  const byCategory: ExpenseCategoryBreakdownItem[] = Array.from(catMap.entries())
    .map(([categoryId, data]) => {
      const previousAmount =
        previousExpenses !== null ? (prevCatMap.get(categoryId) ?? 0) : null;
      const absoluteChange =
        previousAmount !== null
          ? roundCurrencyAmount(subtractDecimal(data.amount, previousAmount), baseCurrency)
          : null;
      const percentageChange =
        previousAmount !== null && previousAmount > 0 && absoluteChange !== null
          ? roundUnitPrice((absoluteChange / previousAmount) * 100)
          : null;

      return {
        categoryId,
        categoryName: categoryMap.get(categoryId)?.name ?? 'Uncategorized',
        amount: data.amount,
        previousAmount,
        absoluteChange,
        percentageChange,
        percentageOfTotal:
          totalExpenses > 0 ? roundUnitPrice((data.amount / totalExpenses) * 100) : 0,
        transactionCount: data.count,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const byAccount: ExpenseAccountBreakdownItem[] = Array.from(accMap.entries())
    .map(([accountId, data]) => ({
      accountId,
      accountName: accountMap.get(accountId)?.name ?? 'Unknown Account',
      amount: data.amount,
      percentageOfTotal:
        totalExpenses > 0 ? roundUnitPrice((data.amount / totalExpenses) * 100) : 0,
      transactionCount: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    currency: baseCurrency,
    totalExpenses,
    previousExpenses,
    expenseChangeAbs,
    expenseChangePct,
    averageMonthlyExpenses,
    monthCount,
    transactionCount,
    largestTransaction,
    trendSeries: toSeries(bucketMap, context.interval),
    monthlySeries: toSeries(monthlyMap, 'monthly'),
    dailySeries: toSeries(dailyMap, 'daily'),
    byCategory,
    byAccount,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
