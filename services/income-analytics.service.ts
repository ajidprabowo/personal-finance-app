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

export interface IncomeTrendPoint {
  bucketKey: string;
  label: string;
  amount: number;
  transactionCount: number;
}

export interface IncomeCategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  amount: number;
  percentageOfTotal: number;
  transactionCount: number;
}

export interface IncomeAccountBreakdownItem {
  accountId: string;
  accountName: string;
  amount: number;
  percentageOfTotal: number;
  transactionCount: number;
}

export interface LargestIncomeRecord {
  id: string;
  date: string;
  description: string;
  categoryName: string;
  accountName: string;
  amount: number;
  currency: string;
  convertedAmount: number;
}

export interface IncomeAnalyticsResult {
  currency: string;
  totalIncome: number;
  previousIncome: number | null;
  incomeChangeAbs: number | null;
  incomeChangePct: number | null;
  averageMonthlyIncome: number;
  monthCount: number;
  transactionCount: number;
  largestTransaction: LargestIncomeRecord | null;
  trendSeries: IncomeTrendPoint[];
  byCategory: IncomeCategoryBreakdownItem[];
  byAccount: IncomeAccountBreakdownItem[];
  excludedCurrencies: string[];
}

export function computeIncomeAnalytics(params: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  manualFxRates: ManualFxRateEntry[];
  context: ResolvedAnalyticsContext;
}): IncomeAnalyticsResult {
  const { transactions, accounts, categories, manualFxRates, context } = params;
  const baseCurrency = context.baseCurrency;
  const excludedSet = new Set<string>();

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const currentIncomeTxs = transactions.filter(
    (tx) =>
      tx.type === 'income' &&
      matchesAnalyticsTransactionFilters(tx, context, context.dateRange)
  );

  const previousIncomeTxs = context.previousDateRange
    ? transactions.filter(
        (tx) =>
          tx.type === 'income' &&
          matchesAnalyticsTransactionFilters(tx, context, context.previousDateRange!)
      )
    : [];

  let totalIncome = 0;
  let transactionCount = 0;
  let largestTransaction: LargestIncomeRecord | null = null;

  const bucketMap = new Map<string, { amount: number; count: number }>();
  const catMap = new Map<string, { amount: number; count: number }>();
  const accMap = new Map<string, { amount: number; count: number }>();

  for (const tx of currentIncomeTxs) {
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
    totalIncome = roundCurrencyAmount(addDecimal(totalIncome, converted), baseCurrency);

    const bucketKey = getAnalyticsBucketKey(tx.date, context.interval, context.firstDayOfWeek);
    const bucket = bucketMap.get(bucketKey) ?? { amount: 0, count: 0 };
    bucket.amount = roundCurrencyAmount(addDecimal(bucket.amount, converted), baseCurrency);
    bucket.count += 1;
    bucketMap.set(bucketKey, bucket);

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

  let previousIncome: number | null = context.previousDateRange ? 0 : null;
  if (previousIncome !== null) {
    for (const tx of previousIncomeTxs) {
      const converted = convertAnalyticsAmount(
        tx.amount,
        tx.currency,
        baseCurrency,
        manualFxRates,
        excludedSet,
        tx.date
      );
      if (converted === null) continue;
      previousIncome = roundCurrencyAmount(addDecimal(previousIncome, converted), baseCurrency);
    }
  }

  const incomeChangeAbs =
    previousIncome !== null
      ? roundCurrencyAmount(subtractDecimal(totalIncome, previousIncome), baseCurrency)
      : null;
  const incomeChangePct =
    previousIncome !== null && previousIncome > 0 && incomeChangeAbs !== null
      ? roundUnitPrice((incomeChangeAbs / previousIncome) * 100)
      : null;

  const monthCount = countMonthsInAnalyticsSpan(
    context.dateRange,
    currentIncomeTxs,
    context.today
  );
  const averageMonthlyIncome =
    monthCount > 0 ? roundCurrencyAmount(totalIncome / monthCount, baseCurrency) : 0;

  const trendSeries: IncomeTrendPoint[] = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketKey, data]) => ({
      bucketKey,
      label: formatAnalyticsBucketLabel(bucketKey, context.interval),
      amount: data.amount,
      transactionCount: data.count,
    }));

  const byCategory: IncomeCategoryBreakdownItem[] = Array.from(catMap.entries())
    .map(([categoryId, data]) => ({
      categoryId,
      categoryName: categoryMap.get(categoryId)?.name ?? 'Uncategorized',
      amount: data.amount,
      percentageOfTotal:
        totalIncome > 0 ? roundUnitPrice((data.amount / totalIncome) * 100) : 0,
      transactionCount: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  const byAccount: IncomeAccountBreakdownItem[] = Array.from(accMap.entries())
    .map(([accountId, data]) => ({
      accountId,
      accountName: accountMap.get(accountId)?.name ?? 'Unknown Account',
      amount: data.amount,
      percentageOfTotal:
        totalIncome > 0 ? roundUnitPrice((data.amount / totalIncome) * 100) : 0,
      transactionCount: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    currency: baseCurrency,
    totalIncome,
    previousIncome,
    incomeChangeAbs,
    incomeChangePct,
    averageMonthlyIncome,
    monthCount,
    transactionCount,
    largestTransaction,
    trendSeries,
    byCategory,
    byAccount,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
