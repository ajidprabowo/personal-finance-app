import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import {
  calendarDayDiff,
  getPeriodDateRange,
  getPreviousEquivalentPeriodRange,
  getTodayInTimezone,
  getWeekStartDateString,
  isDateWithinRange,
  type DateRange,
  type ReportingPeriodPreset,
} from '@/lib/dates';
import { addDecimal } from '@/lib/precision';
import { resolveDefaultChartInterval, type TrendInterval } from '@/services/dashboard-chart.service';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import type { ManualFxRateEntry, RecordOrigin, Transaction } from '@/types/entities';

export interface AnalyticsFilterOptions {
  periodPreset?: ReportingPeriodPreset;
  customStart?: string | null;
  customEnd?: string | null;
  accountId?: string | 'all';
  categoryId?: string | 'all';
  transactionType?: 'all' | 'income' | 'expense';
  platformId?: string | 'all';
  assetClassId?: string | 'all';
  holdingId?: string | 'all';
  interval?: TrendInterval;
  recordOrigin?: RecordOrigin;
  baseCurrency?: string;
  todayOverride?: string;
  firstDayOfWeek?: 'monday' | 'sunday';
}

export interface ResolvedAnalyticsContext {
  periodPreset: ReportingPeriodPreset;
  dateRange: DateRange;
  previousDateRange: DateRange | null;
  interval: TrendInterval;
  firstDayOfWeek: 'monday' | 'sunday';
  today: string;
  baseCurrency: string;
  accountId: string | 'all';
  categoryId: string | 'all';
  transactionType: 'all' | 'income' | 'expense';
  platformId: string | 'all';
  assetClassId: string | 'all';
  holdingId: string | 'all';
}

export function resolveAnalyticsContext(
  options: AnalyticsFilterOptions,
  defaults: { baseCurrency?: string; timezone?: string; firstDayOfWeek?: 'monday' | 'sunday' }
): ResolvedAnalyticsContext {
  const periodPreset: ReportingPeriodPreset = options.periodPreset ?? 'last_6_months';
  const timezone = defaults.timezone ?? APP_CONFIG.defaultTimezone;
  const today = options.todayOverride ?? getTodayInTimezone(timezone);
  const baseCurrency = (
    options.baseCurrency ||
    defaults.baseCurrency ||
    APP_CONFIG.defaultCurrency
  ).toUpperCase();

  const dateRange = getPeriodDateRange(periodPreset, {
    timezone,
    customStart: options.customStart,
    customEnd: options.customEnd,
    todayOverride: today,
  });
  const previousDateRange = getPreviousEquivalentPeriodRange(periodPreset, dateRange);
  const interval = options.interval ?? resolveDefaultChartInterval(periodPreset, dateRange);

  return {
    periodPreset,
    dateRange,
    previousDateRange,
    interval,
    firstDayOfWeek: options.firstDayOfWeek ?? defaults.firstDayOfWeek ?? 'monday',
    today,
    baseCurrency,
    accountId: options.accountId || 'all',
    categoryId: options.categoryId || 'all',
    transactionType: options.transactionType || 'all',
    platformId: options.platformId || 'all',
    assetClassId: options.assetClassId || 'all',
    holdingId: options.holdingId || 'all',
  };
}

export function matchesAnalyticsTransactionFilters(
  tx: Transaction,
  ctx: Pick<ResolvedAnalyticsContext, 'accountId' | 'categoryId' | 'transactionType'>,
  range: DateRange
): boolean {
  if (tx.type !== 'income' && tx.type !== 'expense') return false;
  if (tx.transferGroupId || tx.relatedInvestmentActivityId) return false;
  if (!isDateWithinRange(tx.date, range)) return false;

  if (ctx.transactionType !== 'all' && tx.type !== ctx.transactionType) {
    return false;
  }
  if (ctx.accountId !== 'all' && tx.accountId !== ctx.accountId) {
    return false;
  }
  if (ctx.categoryId !== 'all') {
    const catKey = tx.categoryId || 'uncategorized';
    if (catKey !== ctx.categoryId) return false;
  }

  const amount = Number.isFinite(tx.amount) ? Math.abs(tx.amount) : 0;
  return amount > 0;
}

export function convertAnalyticsAmount(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  manualFxRates: ManualFxRateEntry[],
  excludedCurrencies: Set<string>,
  asOfDate?: string
): number | null {
  const from = fromCurrency.toUpperCase();
  const to = baseCurrency.toUpperCase();
  if (from === to) return roundCurrencyAmount(amount, to);
  const rate = findManualFxRate(manualFxRates, from, to, asOfDate);
  if (!rate) {
    excludedCurrencies.add(from);
    return null;
  }
  return convertCurrencyWithManualRate(amount, from, to, rate).convertedAmount;
}

export function getAnalyticsBucketKey(
  dateStr: string,
  interval: TrendInterval,
  firstDayOfWeek: 'monday' | 'sunday' = 'monday'
): string {
  if (interval === 'daily') return dateStr;
  if (interval === 'monthly') return dateStr.slice(0, 7);
  return getWeekStartDateString(dateStr, firstDayOfWeek);
}

const MONTH_SHORT = [
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
] as const;

export function formatAnalyticsBucketLabel(bucketKey: string, interval: TrendInterval): string {
  if (interval === 'monthly') {
    const [y, m] = bucketKey.split('-');
    return `${MONTH_SHORT[Number(m) - 1] ?? m} ${y}`;
  }
  const [, m, d] = bucketKey.split('-');
  return `${d} ${MONTH_SHORT[Number(m) - 1] ?? m}`;
}

export function countMonthsInAnalyticsSpan(
  dateRange: DateRange,
  transactions: Transaction[],
  today: string
): number {
  let start = dateRange.startDate;
  let end = dateRange.endDate;

  if (!start || !end) {
    const dates = transactions.map((t) => t.date).filter(Boolean).sort();
    if (dates.length === 0) return 1;
    start = start ?? dates[0];
    end = end ?? (dates[dates.length - 1] > today ? dates[dates.length - 1] : today);
  }

  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return Math.max(1, months);
}

export function countSpanDaysInAnalyticsRange(
  dateRange: DateRange,
  transactions: Transaction[],
  today: string
): number {
  let start = dateRange.startDate;
  let end = dateRange.endDate;

  if (!start || !end) {
    const dates = transactions.map((t) => t.date).filter(Boolean).sort();
    if (dates.length === 0) return 0;
    start = start ?? dates[0];
    end = end ?? dates[dates.length - 1];
  } else if (end > today && start <= today) {
    // Cap active span at today for current in-progress periods so average daily spending reflects elapsed days
    end = today;
  }

  if (start > end) return 0;
  return Math.max(1, addDecimal(calendarDayDiff(start, end), 1));
}
