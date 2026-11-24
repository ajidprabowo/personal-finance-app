import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import {
  getPeriodDateRange,
  isDateWithinRange,
  type DateRange,
  type ReportingPeriodPreset,
} from '@/lib/dates';
import { preferencesRepository, transactionsRepository } from '@/repositories';
import type { RecordOrigin, Transaction } from '@/types/entities';

export interface CurrencyCashflowMetrics {
  currency: string;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
  transactionCount: number;
}

export interface FinancialSummarySnapshot {
  periodPreset: ReportingPeriodPreset;
  dateRange: DateRange;
  primaryCurrency: string;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
  byCurrency: Record<string, CurrencyCashflowMetrics>;
}

/**
 * Pure deterministic cashflow summary calculator.
 * - Excludes internal transfers from Total Income, Total Expenses, and Net Cash Flow.
 * - Deduplicates transfer groups so each logical transfer counts as 1 transaction.
 * - Keeps currency buckets separate to prevent invalid cross-currency summation.
 */
export function calculateFinancialSummary(
  transactions: Transaction[],
  options?: {
    periodPreset?: ReportingPeriodPreset;
    dateRange?: DateRange;
    primaryCurrency?: string;
  }
): FinancialSummarySnapshot {
  const periodPreset = options?.periodPreset ?? 'all_time';
  const dateRange = options?.dateRange ?? { startDate: null, endDate: null };
  const primaryCurrency = (options?.primaryCurrency ?? APP_CONFIG.defaultCurrency).toUpperCase();

  const byCurrency: Record<string, CurrencyCashflowMetrics> = {};
  const seenTransferGroups = new Set<string>();

  const ensureBucket = (currency: string): CurrencyCashflowMetrics => {
    const code = currency.toUpperCase();
    if (!byCurrency[code]) {
      byCurrency[code] = {
        currency: code,
        totalIncome: 0,
        totalExpenses: 0,
        netCashFlow: 0,
        incomeCount: 0,
        expenseCount: 0,
        transferCount: 0,
        transactionCount: 0,
      };
    }
    return byCurrency[code];
  };

  let totalIncomeCount = 0;
  let totalExpenseCount = 0;
  let totalTransferCount = 0;

  for (const tx of transactions) {
    if (!isDateWithinRange(tx.date, dateRange)) {
      continue;
    }

    const amount = Number.isFinite(tx.amount) ? Math.abs(tx.amount) : 0;
    if (amount <= 0) continue;

    const bucket = ensureBucket(tx.currency);

    if (tx.type === 'income') {
      bucket.totalIncome = roundCurrencyAmount(bucket.totalIncome + amount, bucket.currency);
      bucket.incomeCount += 1;
      bucket.transactionCount += 1;
      totalIncomeCount += 1;
    } else if (tx.type === 'expense') {
      bucket.totalExpenses = roundCurrencyAmount(bucket.totalExpenses + amount, bucket.currency);
      bucket.expenseCount += 1;
      bucket.transactionCount += 1;
      totalExpenseCount += 1;
    } else if (tx.type === 'transfer') {
      if (tx.transferGroupId) {
        if (seenTransferGroups.has(tx.transferGroupId)) {
          continue;
        }
        seenTransferGroups.add(tx.transferGroupId);
      }
      bucket.transferCount += 1;
      bucket.transactionCount += 1;
      totalTransferCount += 1;
    }
  }

  for (const bucket of Object.values(byCurrency)) {
    bucket.netCashFlow = roundCurrencyAmount(
      bucket.totalIncome - bucket.totalExpenses,
      bucket.currency
    );
  }

  const primaryBucket = byCurrency[primaryCurrency] ?? {
    currency: primaryCurrency,
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    incomeCount: 0,
    expenseCount: 0,
    transferCount: 0,
    transactionCount: 0,
  };

  return {
    periodPreset,
    dateRange,
    primaryCurrency,
    totalIncome: primaryBucket.totalIncome,
    totalExpenses: primaryBucket.totalExpenses,
    netCashFlow: primaryBucket.netCashFlow,
    transactionCount: totalIncomeCount + totalExpenseCount + totalTransferCount,
    incomeCount: totalIncomeCount,
    expenseCount: totalExpenseCount,
    transferCount: totalTransferCount,
    byCurrency,
  };
}

export async function getFinancialSummaryForPeriod(options: {
  preset: ReportingPeriodPreset;
  customStart?: string | null;
  customEnd?: string | null;
  timezone?: string;
  primaryCurrency?: string;
  recordOrigin?: RecordOrigin;
}): Promise<FinancialSummarySnapshot> {
  const origin = options.recordOrigin ?? 'user';
  let timezone = options.timezone;
  let primaryCurrency = options.primaryCurrency;

  if (!timezone || !primaryCurrency) {
    const allPrefs = await preferencesRepository.getAll();
    const pref = allPrefs[0];
    timezone = timezone ?? pref?.timezone ?? APP_CONFIG.defaultTimezone;
    primaryCurrency = primaryCurrency ?? pref?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  }

  const dateRange = getPeriodDateRange(options.preset, {
    timezone,
    customStart: options.customStart,
    customEnd: options.customEnd,
  });

  const transactions = await transactionsRepository.getByOriginAndDateRange(
    origin,
    dateRange.startDate,
    dateRange.endDate
  );

  return calculateFinancialSummary(transactions, {
    periodPreset: options.preset,
    dateRange,
    primaryCurrency,
  });
}
