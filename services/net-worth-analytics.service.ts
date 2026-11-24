import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import type { NetWorthSnapshot } from '@/services/account-balance.service';
import { convertAnalyticsAmount, type ResolvedAnalyticsContext } from '@/services/analytics-filter.service';
import {
  buildDashboardAssetAllocation,
  buildNetWorthTrendSeries,
  type DashboardAssetAllocationItem,
  type NetWorthTrendResult,
} from '@/services/dashboard-chart.service';
import type { InvestmentOverviewSnapshot } from '@/services/investment-summary.service';
import type {
  Account,
  Holding,
  InvestmentActivity,
  ManualFxRateEntry,
  PortfolioValuation,
  Transaction,
} from '@/types/entities';

export interface NetWorthAnalyticsResult {
  currency: string;
  currentNetWorth: number;
  availableCash: number;
  investmentValue: number;
  cashSharePct: number | null;
  investmentSharePct: number | null;
  cashToInvestmentRatio: number | null;
  liabilitiesSupported: false;
  assetBreakdown: DashboardAssetAllocationItem[];
  trend: NetWorthTrendResult;
  periodGrowthAbs: number | null;
  periodGrowthPct: number | null;
  excludedCurrencies: string[];
}

export function computeNetWorthAnalytics(params: {
  accounts: Account[];
  transactions: Transaction[];
  investmentActivities: InvestmentActivity[];
  holdings: Holding[];
  valuations: PortfolioValuation[];
  netWorthSnapshot: NetWorthSnapshot;
  investmentOverview: InvestmentOverviewSnapshot;
  manualFxRates: ManualFxRateEntry[];
  context: ResolvedAnalyticsContext;
}): NetWorthAnalyticsResult {
  const {
    accounts,
    transactions,
    investmentActivities,
    holdings,
    valuations,
    netWorthSnapshot,
    investmentOverview,
    manualFxRates,
    context,
  } = params;
  const baseCurrency = context.baseCurrency;
  const excludedSet = new Set<string>();

  let availableCash = 0;
  let investmentValue = 0;
  let currentNetWorth = 0;

  for (const bucket of Object.values(netWorthSnapshot.byCurrency)) {
    const convCash = convertAnalyticsAmount(
      bucket.liquidCashBalance,
      bucket.currency,
      baseCurrency,
      manualFxRates,
      excludedSet
    );
    const convInv = convertAnalyticsAmount(
      bucket.totalInvestmentValue,
      bucket.currency,
      baseCurrency,
      manualFxRates,
      excludedSet
    );
    if (convCash !== null && convInv !== null) {
      availableCash = roundCurrencyAmount(addDecimal(availableCash, convCash), baseCurrency);
      investmentValue = roundCurrencyAmount(addDecimal(investmentValue, convInv), baseCurrency);
      currentNetWorth = roundCurrencyAmount(addDecimal(availableCash, investmentValue), baseCurrency);
    }
  }

  const totalAssets = addDecimal(Math.max(0, availableCash), Math.max(0, investmentValue));
  const cashSharePct =
    totalAssets > 0 ? roundUnitPrice((Math.max(0, availableCash) / totalAssets) * 100) : null;
  const investmentSharePct =
    totalAssets > 0 ? roundUnitPrice((Math.max(0, investmentValue) / totalAssets) * 100) : null;
  const cashToInvestmentRatio =
    investmentValue > 0 ? roundUnitPrice(availableCash / investmentValue) : null;

  const allocation = buildDashboardAssetAllocation({
    netWorth: netWorthSnapshot,
    investmentOverview,
    manualFxRates,
    baseCurrency,
  });
  for (const c of allocation.excludedCurrencies) excludedSet.add(c);

  const trend = buildNetWorthTrendSeries({
    accounts,
    transactions,
    investmentActivities,
    holdings,
    valuations,
    manualFxRates,
    baseCurrency,
    dateRange: context.dateRange,
    interval: context.interval,
    today: context.today,
  });
  for (const c of trend.excludedCurrencies) excludedSet.add(c);

  let periodGrowthAbs: number | null = null;
  let periodGrowthPct: number | null = null;
  if (trend.hasSufficientData && trend.points.length >= 2) {
    const first = trend.points[0].netWorth;
    const last = trend.points[trend.points.length - 1].netWorth;
    periodGrowthAbs = roundCurrencyAmount(subtractDecimal(last, first), baseCurrency);
    if (first !== 0) {
      periodGrowthPct = roundUnitPrice((periodGrowthAbs / Math.abs(first)) * 100);
    }
  }

  return {
    currency: baseCurrency,
    currentNetWorth,
    availableCash,
    investmentValue,
    cashSharePct,
    investmentSharePct,
    cashToInvestmentRatio,
    liabilitiesSupported: false,
    assetBreakdown: allocation.totalAssetsItems,
    trend,
    periodGrowthAbs,
    periodGrowthPct,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
