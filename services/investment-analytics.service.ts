import { roundCurrencyAmount } from '@/lib/currency';
import { isDateWithinRange } from '@/lib/dates';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  convertAnalyticsAmount,
  formatAnalyticsBucketLabel,
  type ResolvedAnalyticsContext,
} from '@/services/analytics-filter.service';
import type { EnrichedInvestmentActivity } from '@/services/investment-activity.service';
import type { InvestmentOverviewSnapshot } from '@/services/investment-summary.service';
import type { PortfolioPerformanceSnapshot } from '@/services/portfolio-performance.service';
import type { ManualFxRateEntry } from '@/types/entities';

export interface AssetClassPerformanceItem {
  assetClassId: string;
  assetClassName: string;
  assetClassCode: string;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  returnOnCostPct: number | null;
  allocationPct: number;
  holdingCount: number;
}

export interface PlatformPerformanceItem {
  platformId: string;
  platformName: string;
  platformKind: string;
  holdingsMarketValue: number;
  platformCashBalance: number;
  totalPlatformValue: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  allocationPct: number;
  holdingCount: number;
}

export interface InvestmentActivityTrendPoint {
  monthKey: string;
  label: string;
  contributions: number;
  withdrawals: number;
  netContributions: number;
  buys: number;
  sells: number;
  dividendsAndInterest: number;
  fees: number;
}

export interface InvestmentValueTrendPoint {
  date: string;
  label: string;
  portfolioValue: number;
  costBasis: number | null;
  netContributions: number | null;
  source: 'snapshot' | 'current';
}

export interface InvestmentAnalyticsResult {
  currency: string;
  isFilteredSubset: boolean;
  totalInvestmentValue: number;
  holdingsMarketValue: number;
  platformCashBalance: number;
  investmentPoolBalance: number;
  remainingCostBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  realizedPnl: number;
  periodGrossContributions: number;
  periodWithdrawals: number;
  periodNetContributions: number;
  allTimeNetContributions: number;
  dividendAndInterestTotal: number;
  totalFees: number;
  totalGainLoss: number;
  simpleReturnOnNetContributionsPct: number | null;
  byAssetClass: AssetClassPerformanceItem[];
  byPlatform: PlatformPerformanceItem[];
  filteredHoldings: Array<{
    id: string;
    symbol: string;
    name: string;
    platformName: string;
    assetClassName: string;
    currency: string;
    quantity: number;
    marketValue: number;
    convertedMarketValue: number | null;
    costBasis: number;
    convertedCostBasis: number | null;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
    realizedPnl: number;
  }>;
  activityTrend: InvestmentActivityTrendPoint[];
  valueTrend: InvestmentValueTrendPoint[];
  returnMethodologyNote: string;
  excludedCurrencies: string[];
}

export function computeInvestmentAnalytics(params: {
  investmentOverview: InvestmentOverviewSnapshot;
  performanceHistory: PortfolioPerformanceSnapshot;
  manualFxRates: ManualFxRateEntry[];
  context: ResolvedAnalyticsContext;
}): InvestmentAnalyticsResult {
  const { investmentOverview, performanceHistory, manualFxRates, context } = params;
  const baseCurrency = context.baseCurrency;
  const excludedSet = new Set<string>();

  const hasPlatformFilter = context.platformId !== 'all';
  const hasClassFilter = context.assetClassId !== 'all';
  const hasHoldingFilter = context.holdingId !== 'all';
  const isFilteredSubset = hasPlatformFilter || hasClassFilter || hasHoldingFilter;

  const matchingHoldings = investmentOverview.holdings.filter((item) => {
    if (hasPlatformFilter && item.holding.platformId !== context.platformId) return false;
    if (hasClassFilter && item.holding.assetClassId !== context.assetClassId) return false;
    if (hasHoldingFilter && item.holding.id !== context.holdingId) return false;
    return true;
  });

  const matchingHoldingIds = new Set(matchingHoldings.map((h) => h.holding.id));

  let holdingsMarketValue = 0;
  let remainingCostBasis = 0;
  let realizedPnl = 0;

  const assetClassMap = new Map<
    string,
    {
      id: string;
      name: string;
      code: string;
      mv: number;
      cb: number;
      realized: number;
      count: number;
    }
  >();

  const platformHoldingMap = new Map<
    string,
    {
      mv: number;
      cb: number;
      realized: number;
      count: number;
    }
  >();

  const filteredHoldings: InvestmentAnalyticsResult['filteredHoldings'] = [];

  for (const hItem of matchingHoldings) {
    const h = hItem.holding;
    const hCur = h.currency.toUpperCase();
    const convMv = convertAnalyticsAmount(
      hItem.marketValue,
      hCur,
      baseCurrency,
      manualFxRates,
      excludedSet
    );
    const convCb = convertAnalyticsAmount(
      hItem.remainingCostBasis,
      hCur,
      baseCurrency,
      manualFxRates,
      excludedSet
    );
    const convRealized = convertAnalyticsAmount(
      hItem.realizedPnlTotal,
      hCur,
      baseCurrency,
      manualFxRates,
      excludedSet
    );

    filteredHoldings.push({
      id: h.id,
      symbol: h.symbol,
      name: h.name,
      platformName: hItem.platformName,
      assetClassName: hItem.assetClassName,
      currency: hCur,
      quantity: h.quantity,
      marketValue: hItem.marketValue,
      convertedMarketValue: convMv,
      costBasis: hItem.remainingCostBasis,
      convertedCostBasis: convCb,
      unrealizedPnl: hItem.unrealizedPnl,
      unrealizedPnlPct: hItem.unrealizedPnlPct,
      realizedPnl: hItem.realizedPnlTotal,
    });

    if (convMv === null || convCb === null || convRealized === null) continue;

    holdingsMarketValue = roundCurrencyAmount(addDecimal(holdingsMarketValue, convMv), baseCurrency);
    remainingCostBasis = roundCurrencyAmount(addDecimal(remainingCostBasis, convCb), baseCurrency);
    realizedPnl = roundCurrencyAmount(addDecimal(realizedPnl, convRealized), baseCurrency);

    const ac = assetClassMap.get(h.assetClassId) ?? {
      id: h.assetClassId,
      name: hItem.assetClassName,
      code: hItem.assetClassCode,
      mv: 0,
      cb: 0,
      realized: 0,
      count: 0,
    };
    ac.mv = roundCurrencyAmount(addDecimal(ac.mv, convMv), baseCurrency);
    ac.cb = roundCurrencyAmount(addDecimal(ac.cb, convCb), baseCurrency);
    ac.realized = roundCurrencyAmount(addDecimal(ac.realized, convRealized), baseCurrency);
    ac.count += 1;
    assetClassMap.set(h.assetClassId, ac);

    const ph = platformHoldingMap.get(h.platformId) ?? {
      mv: 0,
      cb: 0,
      realized: 0,
      count: 0,
    };
    ph.mv = roundCurrencyAmount(addDecimal(ph.mv, convMv), baseCurrency);
    ph.cb = roundCurrencyAmount(addDecimal(ph.cb, convCb), baseCurrency);
    ph.realized = roundCurrencyAmount(addDecimal(ph.realized, convRealized), baseCurrency);
    ph.count += 1;
    platformHoldingMap.set(h.platformId, ph);
  }

  // Cash balances (Investment Pool + Platform Cash) included when not filtering strictly to asset class / single holding
  let investmentPoolBalance = 0;
  let platformCashBalance = 0;

  if (!hasClassFilter && !hasHoldingFilter) {
    if (!hasPlatformFilter) {
      for (const bucket of Object.values(investmentOverview.byCurrency)) {
        const convPool = convertAnalyticsAmount(
          bucket.investmentPoolBalance,
          bucket.currency,
          baseCurrency,
          manualFxRates,
          excludedSet
        );
        const convPlat = convertAnalyticsAmount(
          bucket.platformCashBalance,
          bucket.currency,
          baseCurrency,
          manualFxRates,
          excludedSet
        );
        if (convPool !== null) {
          investmentPoolBalance = roundCurrencyAmount(
            addDecimal(investmentPoolBalance, convPool),
            baseCurrency
          );
        }
        if (convPlat !== null) {
          platformCashBalance = roundCurrencyAmount(
            addDecimal(platformCashBalance, convPlat),
            baseCurrency
          );
        }
      }
    } else {
      const plat = investmentOverview.platforms.find((p) => p.platform.id === context.platformId);
      if (plat) {
        const convPlat = convertAnalyticsAmount(
          plat.cashBalance,
          plat.currency,
          baseCurrency,
          manualFxRates,
          excludedSet
        );
        if (convPlat !== null) platformCashBalance = convPlat;
      }
    }
  }

  const totalInvestmentValue = roundCurrencyAmount(
    addDecimal(addDecimal(holdingsMarketValue, platformCashBalance), investmentPoolBalance),
    baseCurrency
  );

  // Platform breakdown
  const matchingPlatforms = investmentOverview.platforms.filter((p) =>
    hasPlatformFilter ? p.platform.id === context.platformId : !p.platform.isArchived || p.holdingCount > 0 || p.cashBalance > 0
  );

  const byPlatform: PlatformPerformanceItem[] = matchingPlatforms
    .map((p) => {
      const holdStats = platformHoldingMap.get(p.platform.id) ?? {
        mv: 0,
        cb: 0,
        realized: 0,
        count: 0,
      };
      const platCash =
        !hasClassFilter && !hasHoldingFilter
          ? convertAnalyticsAmount(
              p.cashBalance,
              p.currency,
              baseCurrency,
              manualFxRates,
              excludedSet
            ) ?? 0
          : 0;
      const totalPlatformValue = roundCurrencyAmount(
        addDecimal(holdStats.mv, platCash),
        baseCurrency
      );
      const unrealized = roundCurrencyAmount(
        subtractDecimal(holdStats.mv, holdStats.cb),
        baseCurrency
      );
      const totalPnl = roundCurrencyAmount(
        addDecimal(unrealized, holdStats.realized),
        baseCurrency
      );
      return {
        platformId: p.platform.id,
        platformName: p.platform.name,
        platformKind: p.platform.kind,
        holdingsMarketValue: holdStats.mv,
        platformCashBalance: platCash,
        totalPlatformValue,
        costBasis: holdStats.cb,
        unrealizedPnl: unrealized,
        realizedPnl: holdStats.realized,
        totalPnl,
        allocationPct:
          totalInvestmentValue > 0
            ? roundUnitPrice((totalPlatformValue / totalInvestmentValue) * 100)
            : 0,
        holdingCount: holdStats.count,
      };
    })
    .filter((p) => p.totalPlatformValue > 0 || p.holdingCount > 0 || p.costBasis > 0)
    .sort((a, b) => b.totalPlatformValue - a.totalPlatformValue);

  const byAssetClass: AssetClassPerformanceItem[] = Array.from(assetClassMap.values())
    .map((ac) => {
      const unrealizedPnl = roundCurrencyAmount(subtractDecimal(ac.mv, ac.cb), baseCurrency);
      const totalPnl = roundCurrencyAmount(addDecimal(unrealizedPnl, ac.realized), baseCurrency);
      return {
        assetClassId: ac.id,
        assetClassName: ac.name,
        assetClassCode: ac.code,
        marketValue: ac.mv,
        costBasis: ac.cb,
        unrealizedPnl,
        realizedPnl: ac.realized,
        totalPnl,
        returnOnCostPct: ac.cb > 0 ? roundUnitPrice((unrealizedPnl / ac.cb) * 100) : null,
        allocationPct:
          holdingsMarketValue > 0
            ? roundUnitPrice((ac.mv / holdingsMarketValue) * 100)
            : 0,
        holdingCount: ac.count,
      };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  // Filter activities by platform/holding/assetClass and dateRange
  const matchesActivityEntityFilters = (act: EnrichedInvestmentActivity): boolean => {
    const a = act.activity;
    if (hasPlatformFilter && a.platformId !== context.platformId && a.toPlatformId !== context.platformId) {
      return false;
    }
    if (hasHoldingFilter && a.holdingId !== context.holdingId) {
      return false;
    }
    if (hasClassFilter) {
      if (!a.holdingId || !matchingHoldingIds.has(a.holdingId)) {
        return false;
      }
    }
    return true;
  };

  let allTimeNetContributions = 0;
  let periodGrossContributions = 0;
  let periodWithdrawals = 0;
  let dividendAndInterestTotal = 0;
  let totalFees = 0;

  const activityMonthMap = new Map<
    string,
    {
      contributions: number;
      withdrawals: number;
      buys: number;
      sells: number;
      dividendsAndInterest: number;
      fees: number;
    }
  >();

  for (const item of investmentOverview.recentActivities) {
    if (!matchesActivityEntityFilters(item)) continue;
    const act = item.activity;
    const convGross = convertAnalyticsAmount(
      act.grossAmount,
      act.currency,
      baseCurrency,
      manualFxRates,
      excludedSet
    );
    const convFee = convertAnalyticsAmount(
      act.feeAmount,
      act.currency,
      baseCurrency,
      manualFxRates,
      excludedSet
    );
    if (convGross === null || convFee === null) continue;

    if (act.activityType === 'contribution') {
      allTimeNetContributions = roundCurrencyAmount(
        addDecimal(allTimeNetContributions, convGross),
        baseCurrency
      );
    } else if (act.activityType === 'withdrawal') {
      allTimeNetContributions = roundCurrencyAmount(
        subtractDecimal(allTimeNetContributions, convGross),
        baseCurrency
      );
    }

    if (!isDateWithinRange(act.activityDate, context.dateRange)) continue;

    const mKey = act.activityDate.slice(0, 7);
    const bucket = activityMonthMap.get(mKey) ?? {
      contributions: 0,
      withdrawals: 0,
      buys: 0,
      sells: 0,
      dividendsAndInterest: 0,
      fees: 0,
    };

    if (act.activityType === 'contribution') {
      periodGrossContributions = roundCurrencyAmount(
        addDecimal(periodGrossContributions, convGross),
        baseCurrency
      );
      bucket.contributions = roundCurrencyAmount(
        addDecimal(bucket.contributions, convGross),
        baseCurrency
      );
    } else if (act.activityType === 'withdrawal') {
      periodWithdrawals = roundCurrencyAmount(
        addDecimal(periodWithdrawals, convGross),
        baseCurrency
      );
      bucket.withdrawals = roundCurrencyAmount(
        addDecimal(bucket.withdrawals, convGross),
        baseCurrency
      );
    } else if (act.activityType === 'buy') {
      bucket.buys = roundCurrencyAmount(addDecimal(bucket.buys, convGross), baseCurrency);
      totalFees = roundCurrencyAmount(addDecimal(totalFees, convFee), baseCurrency);
      bucket.fees = roundCurrencyAmount(addDecimal(bucket.fees, convFee), baseCurrency);
    } else if (act.activityType === 'sell' || act.activityType === 'partial_sell') {
      bucket.sells = roundCurrencyAmount(addDecimal(bucket.sells, convGross), baseCurrency);
      totalFees = roundCurrencyAmount(addDecimal(totalFees, convFee), baseCurrency);
      bucket.fees = roundCurrencyAmount(addDecimal(bucket.fees, convFee), baseCurrency);
    } else if (act.activityType === 'dividend' || act.activityType === 'interest') {
      const net = Math.max(0, subtractDecimal(convGross, convFee));
      dividendAndInterestTotal = roundCurrencyAmount(
        addDecimal(dividendAndInterestTotal, net),
        baseCurrency
      );
      bucket.dividendsAndInterest = roundCurrencyAmount(
        addDecimal(bucket.dividendsAndInterest, net),
        baseCurrency
      );
    } else if (act.activityType === 'fee') {
      totalFees = roundCurrencyAmount(addDecimal(totalFees, convFee), baseCurrency);
      bucket.fees = roundCurrencyAmount(addDecimal(bucket.fees, convFee), baseCurrency);
    }

    activityMonthMap.set(mKey, bucket);
  }

  const periodNetContributions = roundCurrencyAmount(
    subtractDecimal(periodGrossContributions, periodWithdrawals),
    baseCurrency
  );
  const unrealizedPnl = roundCurrencyAmount(
    subtractDecimal(holdingsMarketValue, remainingCostBasis),
    baseCurrency
  );
  const unrealizedPnlPct =
    remainingCostBasis > 0 ? roundUnitPrice((unrealizedPnl / remainingCostBasis) * 100) : null;

  const totalGainLoss = roundCurrencyAmount(
    subtractDecimal(
      addDecimal(addDecimal(unrealizedPnl, realizedPnl), dividendAndInterestTotal),
      totalFees
    ),
    baseCurrency
  );
  const simpleReturnOnNetContributionsPct =
    !hasClassFilter && !hasHoldingFilter && allTimeNetContributions > 0
      ? roundUnitPrice((totalGainLoss / allTimeNetContributions) * 100)
      : null;

  const activityTrend: InvestmentActivityTrendPoint[] = Array.from(activityMonthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, d]) => ({
      monthKey,
      label: formatAnalyticsBucketLabel(monthKey, 'monthly'),
      contributions: d.contributions,
      withdrawals: d.withdrawals,
      netContributions: roundCurrencyAmount(
        subtractDecimal(d.contributions, d.withdrawals),
        baseCurrency
      ),
      buys: d.buys,
      sells: d.sells,
      dividendsAndInterest: d.dividendsAndInterest,
      fees: d.fees,
    }));

  // Historical Value Trend from Stage 4 recorded snapshots (honestly distinguishing snapshot vs current)
  const dateAgg = new Map<
    string,
    { mv: number; cb: number | null; netContrib: number | null }
  >();
  for (const snapList of Object.values(performanceHistory.pointsByCurrency)) {
    for (const pt of snapList) {
      if (!isDateWithinRange(pt.date, context.dateRange)) continue;
      if (pt.scope !== 'portfolio' && !hasPlatformFilter && !hasHoldingFilter) continue;
      const convMv = convertAnalyticsAmount(
        pt.portfolioValue,
        pt.currency,
        baseCurrency,
        manualFxRates,
        excludedSet
      );
      if (convMv === null) continue;
      const convCb =
        pt.costBasis !== null
          ? convertAnalyticsAmount(
              pt.costBasis,
              pt.currency,
              baseCurrency,
              manualFxRates,
              excludedSet
            )
          : null;
      const convNetC =
        pt.cumulativeNetContributions !== null
          ? convertAnalyticsAmount(
              pt.cumulativeNetContributions,
              pt.currency,
              baseCurrency,
              manualFxRates,
              excludedSet
            )
          : null;

      const cur = dateAgg.get(pt.date) ?? { mv: 0, cb: null, netContrib: null };
      cur.mv = roundCurrencyAmount(addDecimal(cur.mv, convMv), baseCurrency);
      if (convCb !== null) {
        cur.cb = roundCurrencyAmount(addDecimal(cur.cb ?? 0, convCb), baseCurrency);
      }
      if (convNetC !== null) {
        cur.netContrib = roundCurrencyAmount(
          addDecimal(cur.netContrib ?? 0, convNetC),
          baseCurrency
        );
      }
      dateAgg.set(pt.date, cur);
    }
  }

  const valueTrend: InvestmentValueTrendPoint[] = Array.from(dateAgg.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      label: formatAnalyticsBucketLabel(date, 'daily'),
      portfolioValue: d.mv,
      costBasis: d.cb,
      netContributions: d.netContrib,
      source: 'snapshot',
    }));

  if (
    totalInvestmentValue > 0 &&
    !hasPlatformFilter &&
    !hasClassFilter &&
    !hasHoldingFilter &&
    isDateWithinRange(context.today, context.dateRange) &&
    !valueTrend.some((v) => v.date === context.today)
  ) {
    valueTrend.push({
      date: context.today,
      label: formatAnalyticsBucketLabel(context.today, 'daily'),
      portfolioValue: totalInvestmentValue,
      costBasis: remainingCostBasis,
      netContributions: allTimeNetContributions,
      source: 'current',
    });
  }

  return {
    currency: baseCurrency,
    isFilteredSubset,
    totalInvestmentValue,
    holdingsMarketValue,
    platformCashBalance,
    investmentPoolBalance,
    remainingCostBasis,
    unrealizedPnl,
    unrealizedPnlPct,
    realizedPnl,
    periodGrossContributions,
    periodWithdrawals,
    periodNetContributions,
    allTimeNetContributions,
    dividendAndInterestTotal,
    totalFees,
    totalGainLoss,
    simpleReturnOnNetContributionsPct,
    byAssetClass,
    byPlatform,
    filteredHoldings: filteredHoldings.sort(
      (a, b) => (b.convertedMarketValue ?? b.marketValue) - (a.convertedMarketValue ?? a.marketValue)
    ),
    activityTrend,
    valueTrend,
    returnMethodologyNote: performanceHistory.returnMethodologyNote,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}
