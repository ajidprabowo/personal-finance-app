import { roundCurrencyAmount } from '@/lib/currency';
import {
  calendarDayDiff,
  getTodayInTimezone,
  getWeekStartDateString,
  isDateWithinRange,
  shiftCalendarDays,
  type DateRange,
  type ReportingPeriodPreset,
} from '@/lib/dates';
import { addDecimal, multiplyDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  calculateAccountBalances,
  calculateConsolidatedNetWorth,
  type NetWorthSnapshot,
} from '@/services/account-balance.service';
import type { InvestmentOverviewSnapshot } from '@/services/investment-summary.service';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import type {
  Account,
  Category,
  Holding,
  InvestmentActivity,
  ManualFxRateEntry,
  PortfolioValuation,
  Transaction,
} from '@/types/entities';

export type TrendInterval = 'daily' | 'weekly' | 'monthly';

export interface NetWorthTrendPoint {
  date: string;
  label: string;
  netWorth: number;
  availableCash: number;
  investmentValue: number;
  dataSource: 'snapshot' | 'reconstructed';
  hasSnapshot: boolean;
}

export interface NetWorthTrendResult {
  interval: TrendInterval;
  currency: string;
  points: NetWorthTrendPoint[];
  hasSufficientData: boolean;
  insufficientReason?: string;
  excludedCurrencies: string[];
  snapshotPointCount: number;
  reconstructedPointCount: number;
}

export interface IncomeVsExpensePoint {
  bucketKey: string;
  label: string;
  income: number;
  expenses: number;
  netCashFlow: number;
}

export interface IncomeVsExpenseChartResult {
  interval: TrendInterval;
  currency: string;
  points: IncomeVsExpensePoint[];
  hasData: boolean;
  excludedCurrencies: string[];
}

export interface DashboardAssetAllocationItem {
  id: string;
  name: string;
  value: number;
  percentage: number;
  currency: string;
  detail?: string;
}

export interface DashboardAssetAllocationResult {
  currency: string;
  totalAssetsConverted: number;
  totalAssetsItems: DashboardAssetAllocationItem[];
  investmentOnlyTotalConverted: number;
  investmentOnlyItems: DashboardAssetAllocationItem[];
  excludedCurrencies: string[];
  excludedDetails: Array<{ currency: string; amount: number; section: string }>;
}

export interface ExpenseBreakdownItem {
  categoryId: string;
  categoryName: string;
  amount: number;
  previousAmount: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  percentageOfTotal: number;
  transactionCount: number;
  currency: string;
}

export interface ExpenseBreakdownResult {
  currency: string;
  totalExpenses: number;
  previousTotalExpenses: number | null;
  items: ExpenseBreakdownItem[];
  excludedCurrencies: string[];
}

const MONTH_NAMES = [
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

function formatBucketLabel(dateStr: string, interval: TrendInterval): string {
  const [year, month, day] = dateStr.split('-');
  const mName = MONTH_NAMES[Number(month) - 1] ?? month;
  if (interval === 'monthly') {
    return `${mName} ${year}`;
  }
  return `${day} ${mName}`;
}

export function resolveDefaultChartInterval(
  preset: ReportingPeriodPreset,
  range: DateRange
): TrendInterval {
  if (preset === 'this_month' || preset === 'last_month') return 'daily';
  if (preset === 'last_3_months') return 'weekly';
  if (
    preset === 'last_6_months' ||
    preset === 'last_12_months' ||
    preset === 'this_year' ||
    preset === 'last_year' ||
    preset === 'all_time'
  ) {
    return 'monthly';
  }
  if (range.startDate && range.endDate) {
    const diff = calendarDayDiff(range.startDate, range.endDate);
    if (diff <= 45) return 'daily';
    if (diff <= 140) return 'weekly';
  }
  return 'monthly';
}

function getBucketKey(
  dateStr: string,
  interval: TrendInterval,
  firstDayOfWeek: 'monday' | 'sunday' = 'monday'
): string {
  if (interval === 'daily') return dateStr;
  if (interval === 'monthly') return dateStr.slice(0, 7);
  return getWeekStartDateString(dateStr, firstDayOfWeek);
}

function getBucketEndDate(bucketKey: string, interval: TrendInterval, maxDate: string): string {
  if (interval === 'daily') {
    return bucketKey > maxDate ? maxDate : bucketKey;
  }
  if (interval === 'monthly') {
    const [y, m] = bucketKey.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const endOfMonth = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return endOfMonth > maxDate ? maxDate : endOfMonth;
  }
  const endOfWeek = shiftCalendarDays(bucketKey, 6);
  return endOfWeek > maxDate ? maxDate : endOfWeek;
}

function convertAmountSafely(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  manualFxRates: ManualFxRateEntry[],
  excludedSet: Set<string>,
  asOfDate?: string
): number | null {
  const from = fromCurrency.toUpperCase();
  const to = baseCurrency.toUpperCase();
  if (from === to) return roundCurrencyAmount(amount, to);
  const rate = findManualFxRate(manualFxRates, from, to, asOfDate);
  if (!rate) {
    excludedSet.add(from);
    return null;
  }
  return convertCurrencyWithManualRate(amount, from, to, rate).convertedAmount;
}

/**
 * Computes whether a holding had an open position (> 0 units) on or before `asOfDate`
 * from recorded buy/sell activities.
 */
function getHoldingQuantityOnDate(
  holdingId: string,
  activities: InvestmentActivity[],
  asOfDate: string
): number {
  let qty = 0;
  for (const act of activities) {
    if (act.holdingId !== holdingId || act.activityDate > asOfDate) continue;
    const q = Number(act.quantity ?? 0);
    if (act.activityType === 'buy') {
      qty = addDecimal(qty, q);
    } else if (act.activityType === 'sell' || act.activityType === 'partial_sell') {
      qty = Math.max(0, subtractDecimal(qty, q));
    }
  }
  return qty;
}

/**
 * Reconstructs historical Net Worth, Available Cash, and Investment Value strictly from real data:
 * - Uses Stage 3's calculateAccountBalances for point-in-time cash balances up to each date.
 * - Uses Stage 4's recorded PortfolioValuation snapshots for historical holding market values.
 * - Never projects today's market price backward onto past dates before valuation snapshots exist.
 */
export function buildNetWorthTrendSeries(params: {
  accounts: Account[];
  transactions: Transaction[];
  investmentActivities: InvestmentActivity[];
  holdings: Holding[];
  valuations: PortfolioValuation[];
  manualFxRates: ManualFxRateEntry[];
  baseCurrency: string;
  dateRange: DateRange;
  interval: TrendInterval;
  firstDayOfWeek?: 'monday' | 'sunday';
  today?: string;
}): NetWorthTrendResult {
  const baseCurrency = params.baseCurrency.toUpperCase();
  const today = params.today ?? getTodayInTimezone();
  const excludedSet = new Set<string>();

  const datedEvents: string[] = [];
  for (const tx of params.transactions) datedEvents.push(tx.date);
  for (const act of params.investmentActivities) datedEvents.push(act.activityDate);
  for (const val of params.valuations) datedEvents.push(val.valuationDate);

  const uniqueEventDates = Array.from(new Set(datedEvents.filter((d) => d <= today))).sort();
  if (uniqueEventDates.length === 0) {
    return {
      interval: params.interval,
      currency: baseCurrency,
      points: [],
      hasSufficientData: false,
      insufficientReason:
        'Record transactions or portfolio valuations on at least two different dates to display a Net Worth trend.',
      excludedCurrencies: [],
      snapshotPointCount: 0,
      reconstructedPointCount: 0,
    };
  }

  const effectiveEnd =
    params.dateRange.endDate && params.dateRange.endDate < today
      ? params.dateRange.endDate
      : today;
  const earliestEvent = uniqueEventDates[0];
  const effectiveStart =
    params.dateRange.startDate && params.dateRange.startDate > earliestEvent
      ? params.dateRange.startDate
      : earliestEvent;

  if (effectiveStart > effectiveEnd) {
    return {
      interval: params.interval,
      currency: baseCurrency,
      points: [],
      hasSufficientData: false,
      insufficientReason: 'No historical records fall inside the selected reporting period.',
      excludedCurrencies: [],
      snapshotPointCount: 0,
      reconstructedPointCount: 0,
    };
  }

  // Generate bucket end-dates strictly from buckets that have activity or snapshots + effectiveEnd
  const relevantDates = uniqueEventDates.filter(
    (d) => d >= effectiveStart && d <= effectiveEnd
  );
  if (!relevantDates.includes(effectiveEnd) && effectiveEnd <= today) {
    relevantDates.push(effectiveEnd);
  }

  const bucketEndDates = Array.from(
    new Set(
      relevantDates.map((d) =>
        getBucketEndDate(
          getBucketKey(d, params.interval, params.firstDayOfWeek),
          params.interval,
          effectiveEnd
        )
      )
    )
  ).sort();

  const points: NetWorthTrendPoint[] = [];
  let snapshotPointCount = 0;
  let reconstructedPointCount = 0;

  for (const asOfDate of bucketEndDates) {
    const txsUpToDate = params.transactions.filter((t) => t.date <= asOfDate);
    const actsUpToDate = params.investmentActivities.filter((a) => a.activityDate <= asOfDate);

    // If asOfDate === today and there are no future-dated entries skewing today, we can evaluate current holdings directly
    const isCurrentSnapshotDate = asOfDate >= today;

    let holdingValuesPossible = true;
    let usedRecordedSnapshot = false;
    const holdingsValuedByCurrency = new Map<string, number>();

    // Check portfolio-level manual valuation snapshots explicitly saved for this exact date
    const portfolioSnapsOnDate = params.valuations.filter(
      (v) => v.scope === 'portfolio' && v.valuationDate === asOfDate
    );

    if (isCurrentSnapshotDate) {
      const currentNw = calculateConsolidatedNetWorth(
        params.accounts,
        txsUpToDate,
        actsUpToDate,
        params.holdings
      );
      let totalCash = 0;
      let totalInv = 0;
      let totalNw = 0;

      for (const bucket of Object.values(currentNw.byCurrency)) {
        const cashConv = convertAmountSafely(
          bucket.liquidCashBalance,
          bucket.currency,
          baseCurrency,
          params.manualFxRates,
          excludedSet,
          asOfDate
        );
        const invConv = convertAmountSafely(
          bucket.totalInvestmentValue,
          bucket.currency,
          baseCurrency,
          params.manualFxRates,
          excludedSet,
          asOfDate
        );
        if (cashConv !== null && invConv !== null) {
          totalCash = roundCurrencyAmount(addDecimal(totalCash, cashConv), baseCurrency);
          totalInv = roundCurrencyAmount(addDecimal(totalInv, invConv), baseCurrency);
          totalNw = roundCurrencyAmount(addDecimal(totalCash, totalInv), baseCurrency);
        }
      }

      const hasSnapOnToday = params.valuations.some((v) => v.valuationDate === asOfDate);
      if (hasSnapOnToday) {
        snapshotPointCount += 1;
      } else {
        reconstructedPointCount += 1;
      }

      points.push({
        date: asOfDate,
        label: formatBucketLabel(asOfDate, params.interval),
        netWorth: totalNw,
        availableCash: totalCash,
        investmentValue: totalInv,
        dataSource: hasSnapOnToday ? 'snapshot' : 'reconstructed',
        hasSnapshot: hasSnapOnToday,
      });
      continue;
    }

    // Historical point strictly before today:
    // Reconstruct cash balances via Stage 3 engine, and require explicit valuation snapshots for open holdings!
    const balances = calculateAccountBalances(params.accounts, txsUpToDate, actsUpToDate);

    // Check holdings open on asOfDate
    for (const h of params.holdings) {
      const qtyOnDate = getHoldingQuantityOnDate(h.id, actsUpToDate, asOfDate);
      if (qtyOnDate <= 0) continue;

      // Look for explicit holding snapshot on or before asOfDate
      const matchingHoldingSnap = params.valuations
        .filter((v) => v.scope === 'holding' && v.holdingId === h.id && v.valuationDate <= asOfDate)
        .sort((a, b) => b.valuationDate.localeCompare(a.valuationDate))[0];

      if (matchingHoldingSnap) {
        usedRecordedSnapshot = true;
        const mv =
          typeof matchingHoldingSnap.unitPrice === 'number'
            ? roundCurrencyAmount(
                multiplyDecimal(qtyOnDate, matchingHoldingSnap.unitPrice),
                h.currency
              )
            : roundCurrencyAmount(matchingHoldingSnap.marketValue, h.currency);
        const cur = h.currency.toUpperCase();
        holdingsValuedByCurrency.set(
          cur,
          roundCurrencyAmount(addDecimal(holdingsValuedByCurrency.get(cur) ?? 0, mv), cur)
        );
      } else {
        holdingValuesPossible = false;
      }
    }

    // If a portfolio-scope snapshot exists directly on asOfDate, use its total investment value per currency
    if (portfolioSnapsOnDate.length > 0) {
      usedRecordedSnapshot = true;
      let totalCash = 0;
      let totalInv = 0;

      for (const tot of Object.values(balances.totalsByCurrency)) {
        const cashConv = convertAmountSafely(
          tot.liquidCashBalance,
          tot.currency,
          baseCurrency,
          params.manualFxRates,
          excludedSet,
          asOfDate
        );
        if (cashConv !== null) {
          totalCash = roundCurrencyAmount(addDecimal(totalCash, cashConv), baseCurrency);
        }
      }

      for (const snap of portfolioSnapsOnDate) {
        const invConv = convertAmountSafely(
          snap.marketValue,
          snap.currency,
          baseCurrency,
          params.manualFxRates,
          excludedSet,
          asOfDate
        );
        if (invConv !== null) {
          totalInv = roundCurrencyAmount(addDecimal(totalInv, invConv), baseCurrency);
        }
      }

      snapshotPointCount += 1;
      points.push({
        date: asOfDate,
        label: formatBucketLabel(asOfDate, params.interval),
        netWorth: roundCurrencyAmount(addDecimal(totalCash, totalInv), baseCurrency),
        availableCash: totalCash,
        investmentValue: totalInv,
        dataSource: 'snapshot',
        hasSnapshot: true,
      });
      continue;
    }

    if (!holdingValuesPossible) {
      // Do NOT pretend today's valuation was valid in the past when no historical snapshot exists for open holdings
      continue;
    }

    let totalCash = 0;
    let totalInv = 0;

    for (const tot of Object.values(balances.totalsByCurrency)) {
      const cashConv = convertAmountSafely(
        tot.liquidCashBalance,
        tot.currency,
        baseCurrency,
        params.manualFxRates,
        excludedSet,
        asOfDate
      );
      const invCashConv = convertAmountSafely(
        addDecimal(tot.investmentPoolBalance, tot.platformCashBalance),
        tot.currency,
        baseCurrency,
        params.manualFxRates,
        excludedSet,
        asOfDate
      );
      if (cashConv !== null) {
        totalCash = roundCurrencyAmount(addDecimal(totalCash, cashConv), baseCurrency);
      }
      if (invCashConv !== null) {
        totalInv = roundCurrencyAmount(addDecimal(totalInv, invCashConv), baseCurrency);
      }
    }

    for (const [cur, mv] of holdingsValuedByCurrency.entries()) {
      const conv = convertAmountSafely(
        mv,
        cur,
        baseCurrency,
        params.manualFxRates,
        excludedSet,
        asOfDate
      );
      if (conv !== null) {
        totalInv = roundCurrencyAmount(addDecimal(totalInv, conv), baseCurrency);
      }
    }

    if (usedRecordedSnapshot) {
      snapshotPointCount += 1;
    } else {
      reconstructedPointCount += 1;
    }

    points.push({
      date: asOfDate,
      label: formatBucketLabel(asOfDate, params.interval),
      netWorth: roundCurrencyAmount(addDecimal(totalCash, totalInv), baseCurrency),
      availableCash: totalCash,
      investmentValue: totalInv,
      dataSource: usedRecordedSnapshot ? 'snapshot' : 'reconstructed',
      hasSnapshot: usedRecordedSnapshot,
    });
  }

  const hasSufficientData = points.length >= 2;

  return {
    interval: params.interval,
    currency: baseCurrency,
    points,
    hasSufficientData,
    insufficientReason: hasSufficientData
      ? undefined
      : params.holdings.some((h) => h.quantity > 0) && params.valuations.length === 0
        ? 'Historical valuation snapshots are needed to chart past investment values alongside cash history. Record a snapshot on the Investments page or continue logging dated transactions.'
        : 'At least two distinct dated financial checkpoints are required to display a historical trend.',
    excludedCurrencies: Array.from(excludedSet).sort(),
    snapshotPointCount,
    reconstructedPointCount,
  };
}

/**
 * Aggregates Stage 3 income & expense transactions by day, week, or month.
 * Strictly excludes internal transfers, investment contributions, and platform transfers.
 */
export function buildIncomeVsExpenseSeries(params: {
  transactions: Transaction[];
  manualFxRates: ManualFxRateEntry[];
  baseCurrency: string;
  dateRange: DateRange;
  interval: TrendInterval;
  firstDayOfWeek?: 'monday' | 'sunday';
}): IncomeVsExpenseChartResult {
  const baseCurrency = params.baseCurrency.toUpperCase();
  const excludedSet = new Set<string>();
  const buckets = new Map<string, { income: number; expenses: number }>();

  for (const tx of params.transactions) {
    if (tx.type !== 'income' && tx.type !== 'expense') continue;
    if (!isDateWithinRange(tx.date, params.dateRange)) continue;

    const amount = Number.isFinite(tx.amount) ? Math.abs(tx.amount) : 0;
    if (amount <= 0) continue;

    const converted = convertAmountSafely(
      amount,
      tx.currency,
      baseCurrency,
      params.manualFxRates,
      excludedSet,
      tx.date
    );
    if (converted === null) continue;

    const key = getBucketKey(tx.date, params.interval, params.firstDayOfWeek);
    const cur = buckets.get(key) ?? { income: 0, expenses: 0 };
    if (tx.type === 'income') {
      cur.income = roundCurrencyAmount(addDecimal(cur.income, converted), baseCurrency);
    } else {
      cur.expenses = roundCurrencyAmount(addDecimal(cur.expenses, converted), baseCurrency);
    }
    buckets.set(key, cur);
  }

  const points: IncomeVsExpensePoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketKey, vals]) => ({
      bucketKey,
      label:
        params.interval === 'monthly'
          ? formatBucketLabel(`${bucketKey}-01`, 'monthly')
          : formatBucketLabel(bucketKey, params.interval),
      income: vals.income,
      expenses: vals.expenses,
      netCashFlow: roundCurrencyAmount(subtractDecimal(vals.income, vals.expenses), baseCurrency),
    }));

  return {
    interval: params.interval,
    currency: baseCurrency,
    points,
    hasData: points.length > 0,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}

/**
 * Computes both:
 * 1. Total Financial Assets distribution (Cash & Bank, E-Wallet, Investment Pool, Platform Cash, Holdings)
 * 2. Investment Portfolio distribution by Asset Class (reusing Stage 4 investmentOverview)
 */
export function buildDashboardAssetAllocation(params: {
  netWorth: NetWorthSnapshot;
  investmentOverview: InvestmentOverviewSnapshot;
  manualFxRates: ManualFxRateEntry[];
  baseCurrency: string;
}): DashboardAssetAllocationResult {
  const baseCurrency = params.baseCurrency.toUpperCase();
  const excludedSet = new Set<string>();
  const excludedDetails: Array<{ currency: string; amount: number; section: string }> = [];

  let cashAndBank = 0;
  let ewallet = 0;
  let investmentPool = 0;
  let platformCash = 0;
  let holdingsTotal = 0;

  for (const item of params.netWorth.balances.items) {
    if (item.excludedFromConsolidatedTotal) continue;
    const val = Math.max(0, item.currentBalance);
    if (val === 0) continue;

    const conv = convertAmountSafely(
      val,
      item.account.currency,
      baseCurrency,
      params.manualFxRates,
      excludedSet
    );
    if (conv === null) {
      excludedDetails.push({
        currency: item.account.currency.toUpperCase(),
        amount: val,
        section: item.account.name,
      });
      continue;
    }

    if (item.account.type === 'investment_pool' || item.account.isInvestmentPool) {
      investmentPool = roundCurrencyAmount(addDecimal(investmentPool, conv), baseCurrency);
    } else if (item.account.type === 'investment_cash') {
      platformCash = roundCurrencyAmount(addDecimal(platformCash, conv), baseCurrency);
    } else if (item.account.type === 'ewallet') {
      ewallet = roundCurrencyAmount(addDecimal(ewallet, conv), baseCurrency);
    } else {
      cashAndBank = roundCurrencyAmount(addDecimal(cashAndBank, conv), baseCurrency);
    }
  }

  for (const bucket of Object.values(params.netWorth.byCurrency)) {
    if (bucket.holdingsMarketValue <= 0) continue;
    const conv = convertAmountSafely(
      bucket.holdingsMarketValue,
      bucket.currency,
      baseCurrency,
      params.manualFxRates,
      excludedSet
    );
    if (conv === null) {
      excludedDetails.push({
        currency: bucket.currency,
        amount: bucket.holdingsMarketValue,
        section: `Holdings (${bucket.currency})`,
      });
      continue;
    }
    holdingsTotal = roundCurrencyAmount(addDecimal(holdingsTotal, conv), baseCurrency);
  }

  const rawTotalRows: Array<{ id: string; name: string; value: number; detail: string }> = [
    { id: 'cash_bank', name: 'Cash & Bank', value: cashAndBank, detail: 'Bank, Cash, and General Accounts' },
    { id: 'ewallet', name: 'E-Wallet', value: ewallet, detail: 'Digital Payment Wallets' },
    { id: 'investment_pool', name: 'Investment Pool', value: investmentPool, detail: 'Unallocated Investment Reserve' },
    { id: 'platform_cash', name: 'Platform Cash', value: platformCash, detail: 'Broker & Exchange Cash Balances' },
    { id: 'investment_holdings', name: 'Investment Holdings', value: holdingsTotal, detail: 'Holdings at Current Market Value' },
  ].filter((r) => r.value > 0);

  const totalAssetsConverted = rawTotalRows.reduce(
    (sum, row) => roundCurrencyAmount(addDecimal(sum, row.value), baseCurrency),
    0
  );

  const totalAssetsItems: DashboardAssetAllocationItem[] = rawTotalRows.map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value,
    percentage:
      totalAssetsConverted > 0 ? roundUnitPrice((row.value / totalAssetsConverted) * 100) : 0,
    currency: baseCurrency,
    detail: row.detail,
  }));

  // Investment-only asset allocation reusing Stage 4 asset classes
  const invClassMap = new Map<string, { id: string; name: string; value: number; code: string }>();

  for (const list of Object.values(params.investmentOverview.assetAllocationByCurrency)) {
    for (const slice of list) {
      if (slice.marketValue <= 0) continue;
      const conv = convertAmountSafely(
        slice.marketValue,
        slice.currency,
        baseCurrency,
        params.manualFxRates,
        excludedSet
      );
      if (conv === null) continue;
      const existing = invClassMap.get(slice.assetClassId) ?? {
        id: slice.assetClassId,
        name: slice.assetClassName,
        value: 0,
        code: slice.assetClassCode,
      };
      existing.value = roundCurrencyAmount(addDecimal(existing.value, conv), baseCurrency);
      invClassMap.set(slice.assetClassId, existing);
    }
  }

  const investmentOnlyRaw = Array.from(invClassMap.values()).sort((a, b) => b.value - a.value);
  const investmentOnlyTotalConverted = investmentOnlyRaw.reduce(
    (sum, row) => roundCurrencyAmount(addDecimal(sum, row.value), baseCurrency),
    0
  );
  const investmentOnlyItems: DashboardAssetAllocationItem[] = investmentOnlyRaw.map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value,
    percentage:
      investmentOnlyTotalConverted > 0
        ? roundUnitPrice((row.value / investmentOnlyTotalConverted) * 100)
        : 0,
    currency: baseCurrency,
    detail: row.code,
  }));

  return {
    currency: baseCurrency,
    totalAssetsConverted,
    totalAssetsItems,
    investmentOnlyTotalConverted,
    investmentOnlyItems,
    excludedCurrencies: Array.from(excludedSet).sort(),
    excludedDetails,
  };
}

/**
 * Computes actual Expense Breakdown by Category within the selected dateRange,
 * plus previous equivalent period category comparison when available.
 */
export function buildExpenseBreakdown(params: {
  transactions: Transaction[];
  categories: Category[];
  manualFxRates: ManualFxRateEntry[];
  baseCurrency: string;
  currentRange: DateRange;
  previousRange: DateRange | null;
}): ExpenseBreakdownResult {
  const baseCurrency = params.baseCurrency.toUpperCase();
  const excludedSet = new Set<string>();
  const categoryMap = new Map(params.categories.map((c) => [c.id, c]));

  const currentMap = new Map<string, { amount: number; count: number }>();
  const prevMap = new Map<string, number>();

  let totalExpenses = 0;
  let previousTotalExpenses = params.previousRange ? 0 : null;

  for (const tx of params.transactions) {
    if (tx.type !== 'expense') continue;
    const amount = Number.isFinite(tx.amount) ? Math.abs(tx.amount) : 0;
    if (amount <= 0) continue;

    const inCurrent = isDateWithinRange(tx.date, params.currentRange);
    const inPrevious = params.previousRange ? isDateWithinRange(tx.date, params.previousRange) : false;
    if (!inCurrent && !inPrevious) continue;

    const conv = convertAmountSafely(
      amount,
      tx.currency,
      baseCurrency,
      params.manualFxRates,
      excludedSet,
      tx.date
    );
    if (conv === null) continue;

    const catKey = tx.categoryId || 'uncategorized';

    if (inCurrent) {
      totalExpenses = roundCurrencyAmount(addDecimal(totalExpenses, conv), baseCurrency);
      const bucket = currentMap.get(catKey) ?? { amount: 0, count: 0 };
      bucket.amount = roundCurrencyAmount(addDecimal(bucket.amount, conv), baseCurrency);
      bucket.count += 1;
      currentMap.set(catKey, bucket);
    }

    if (inPrevious && previousTotalExpenses !== null) {
      previousTotalExpenses = roundCurrencyAmount(
        addDecimal(previousTotalExpenses, conv),
        baseCurrency
      );
      prevMap.set(catKey, roundCurrencyAmount(addDecimal(prevMap.get(catKey) ?? 0, conv), baseCurrency));
    }
  }

  const items: ExpenseBreakdownItem[] = Array.from(currentMap.entries())
    .map(([categoryId, data]) => {
      const cat = categoryMap.get(categoryId);
      const previousAmount = params.previousRange ? (prevMap.get(categoryId) ?? 0) : null;
      const absoluteChange =
        previousAmount !== null
          ? roundCurrencyAmount(subtractDecimal(data.amount, previousAmount), baseCurrency)
          : null;
      const percentageChange =
        previousAmount !== null && previousAmount > 0
          ? roundUnitPrice(((data.amount - previousAmount) / previousAmount) * 100)
          : null;

      return {
        categoryId,
        categoryName: cat?.name ?? 'Uncategorized',
        amount: data.amount,
        previousAmount,
        absoluteChange,
        percentageChange,
        percentageOfTotal:
          totalExpenses > 0 ? roundUnitPrice((data.amount / totalExpenses) * 100) : 0,
        transactionCount: data.count,
        currency: baseCurrency,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    currency: baseCurrency,
    totalExpenses,
    previousTotalExpenses,
    items,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
