import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  assetClassesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  preferencesRepository,
} from '@/repositories';
import {
  getNetWorthSnapshot,
  resolveHoldingMarketValue,
  type NetWorthSnapshot,
} from '@/services/account-balance.service';
import { computeUnrealizedPnl } from '@/services/cost-basis.service';
import { listHoldingsWithMetrics, type HoldingEnriched } from '@/services/holding.service';
import {
  listInvestmentActivitiesFiltered,
  type EnrichedInvestmentActivity,
} from '@/services/investment-activity.service';
import {
  listPlatformsWithMetrics,
  type PlatformWithMetrics,
} from '@/services/investment-platform.service';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import type { ManualFxRateEntry, RecordOrigin } from '@/types/entities';

export interface CurrencyInvestmentMetrics {
  currency: string;
  investmentPoolBalance: number;
  platformCashBalance: number;
  holdingsMarketValue: number;
  totalInvestmentValue: number;
  grossContributions: number;
  withdrawalsToMainBalance: number;
  netContributions: number;
  remainingCostBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  realizedPnl: number;
  dividendIncome: number;
  interestIncome: number;
  totalFees: number;
  totalInvestmentGainLoss: number;
  simpleReturnOnNetContributionsPct: number | null;
}

export interface AssetAllocationItem {
  assetClassId: string;
  assetClassName: string;
  assetClassCode: string;
  currency: string;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalPnl: number;
  percentageOfCurrencyHoldings: number;
  holdingCount: number;
}

export interface ConvertedPortfolioTotals {
  baseCurrency: string;
  canConvertAll: boolean;
  missingCurrencies: string[];
  appliedRates: ManualFxRateEntry[];
  totalInvestmentValue: number;
  netContributions: number;
  holdingsMarketValue: number;
  remainingCostBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  realizedPnl: number;
  totalInvestmentGainLoss: number;
  totalNetWorth: number;
}

export interface InvestmentOverviewSnapshot {
  baseCurrency: string;
  currencies: string[];
  byCurrency: Record<string, CurrencyInvestmentMetrics>;
  convertedTotals: ConvertedPortfolioTotals;
  assetAllocationByCurrency: Record<string, AssetAllocationItem[]>;
  convertedAssetAllocation: Array<{
    assetClassId: string;
    assetClassName: string;
    assetClassCode: string;
    convertedMarketValue: number;
    convertedCostBasis: number;
    convertedPnl: number;
    percentage: number;
  }>;
  platforms: PlatformWithMetrics[];
  holdings: HoldingEnriched[];
  recentActivities: EnrichedInvestmentActivity[];
  netWorth: NetWorthSnapshot;
}

export async function getInvestmentOverviewSnapshot(options?: {
  recordOrigin?: RecordOrigin;
  baseCurrency?: string;
}): Promise<InvestmentOverviewSnapshot> {
  const origin = options?.recordOrigin ?? 'user';

  const [
    prefsList,
    netWorth,
    platforms,
    holdingsEnriched,
    rawHoldings,
    assetClasses,
    activitiesEnriched,
    rawActivities,
  ] = await Promise.all([
    preferencesRepository.getAll(),
    getNetWorthSnapshot({ recordOrigin: origin }),
    listPlatformsWithMetrics({ includeArchived: true, recordOrigin: origin }),
    listHoldingsWithMetrics({ includeZeroQuantity: true, recordOrigin: origin }),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
    origin === 'test'
      ? assetClassesRepository.getTestRecords()
      : assetClassesRepository.getUserRecords(),
    listInvestmentActivitiesFiltered({ recordOrigin: origin, sortOrder: 'newest' }),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
  ]);

  const prefs = prefsList[0];
  const baseCurrency = (
    options?.baseCurrency ||
    prefs?.baseCurrency ||
    APP_CONFIG.defaultCurrency
  ).toUpperCase();
  const manualFxRates = prefs?.manualFxRates ?? [];

  const byCurrency: Record<string, CurrencyInvestmentMetrics> = {};
  const ensureCurrencyBucket = (currency: string): CurrencyInvestmentMetrics => {
    const code = currency.toUpperCase();
    if (!byCurrency[code]) {
      byCurrency[code] = {
        currency: code,
        investmentPoolBalance: 0,
        platformCashBalance: 0,
        holdingsMarketValue: 0,
        totalInvestmentValue: 0,
        grossContributions: 0,
        withdrawalsToMainBalance: 0,
        netContributions: 0,
        remainingCostBasis: 0,
        unrealizedPnl: 0,
        unrealizedPnlPct: null,
        realizedPnl: 0,
        dividendIncome: 0,
        interestIncome: 0,
        totalFees: 0,
        totalInvestmentGainLoss: 0,
        simpleReturnOnNetContributionsPct: null,
      };
    }
    return byCurrency[code];
  };

  // Seed cash & holding market values directly from unified Net Worth engine (zero double counting)
  for (const nw of Object.values(netWorth.byCurrency)) {
    const hasInvestmentFootprint =
      nw.investmentPoolBalance !== 0 ||
      nw.platformCashBalance !== 0 ||
      nw.holdingsMarketValue !== 0;
    if (!hasInvestmentFootprint && nw.currency !== baseCurrency) continue;

    const bucket = ensureCurrencyBucket(nw.currency);
    bucket.investmentPoolBalance = nw.investmentPoolBalance;
    bucket.platformCashBalance = nw.platformCashBalance;
    bucket.holdingsMarketValue = nw.holdingsMarketValue;
    bucket.totalInvestmentValue = nw.totalInvestmentValue;
  }

  for (const p of platforms) {
    ensureCurrencyBucket(p.currency);
  }

  for (const h of rawHoldings) {
    const code = h.currency.toUpperCase();
    const bucket = ensureCurrencyBucket(code);
    const cb = roundCurrencyAmount(
      h.remainingCostBasis ?? h.quantity * (h.averageCostPerUnit || 0),
      code
    );
    const realized = roundCurrencyAmount(h.realizedPnlTotal ?? 0, code);
    bucket.remainingCostBasis = roundCurrencyAmount(
      addDecimal(bucket.remainingCostBasis, cb),
      code
    );
    bucket.realizedPnl = roundCurrencyAmount(addDecimal(bucket.realizedPnl, realized), code);
  }

  for (const act of rawActivities) {
    const code = act.currency.toUpperCase();
    const bucket = ensureCurrencyBucket(code);

    if (act.activityType === 'contribution') {
      bucket.grossContributions = roundCurrencyAmount(
        addDecimal(bucket.grossContributions, act.grossAmount),
        code
      );
    } else if (act.activityType === 'withdrawal') {
      bucket.withdrawalsToMainBalance = roundCurrencyAmount(
        addDecimal(bucket.withdrawalsToMainBalance, act.grossAmount),
        code
      );
    } else if (act.activityType === 'dividend') {
      const netDiv = act.netAmount ?? Math.max(0, subtractDecimal(act.grossAmount, act.feeAmount));
      bucket.dividendIncome = roundCurrencyAmount(addDecimal(bucket.dividendIncome, netDiv), code);
    } else if (act.activityType === 'interest') {
      const netInt = act.netAmount ?? Math.max(0, subtractDecimal(act.grossAmount, act.feeAmount));
      bucket.interestIncome = roundCurrencyAmount(addDecimal(bucket.interestIncome, netInt), code);
    } else if (act.activityType === 'fee') {
      bucket.totalFees = roundCurrencyAmount(addDecimal(bucket.totalFees, act.feeAmount), code);
    } else if (act.activityType === 'buy' || act.activityType === 'sell' || act.activityType === 'partial_sell') {
      bucket.totalFees = roundCurrencyAmount(addDecimal(bucket.totalFees, act.feeAmount), code);
    }
  }

  for (const bucket of Object.values(byCurrency)) {
    bucket.netContributions = roundCurrencyAmount(
      subtractDecimal(bucket.grossContributions, bucket.withdrawalsToMainBalance),
      bucket.currency
    );

    const unrealized = computeUnrealizedPnl(
      bucket.holdingsMarketValue,
      bucket.remainingCostBasis,
      bucket.currency
    );
    bucket.unrealizedPnl = unrealized.unrealizedPnl;
    bucket.unrealizedPnlPct = unrealized.unrealizedPnlPct;

    // Total Investment Gain/Loss = Unrealized P/L + Realized P/L + Dividend & Interest Income - Standalone Fees
    const incomeAndPnl = addDecimal(
      addDecimal(bucket.unrealizedPnl, bucket.realizedPnl),
      addDecimal(bucket.dividendIncome, bucket.interestIncome)
    );
    bucket.totalInvestmentGainLoss = roundCurrencyAmount(
      subtractDecimal(incomeAndPnl, bucket.totalFees),
      bucket.currency
    );

    bucket.simpleReturnOnNetContributionsPct =
      bucket.netContributions > 0
        ? roundUnitPrice((bucket.totalInvestmentGainLoss / bucket.netContributions) * 100)
        : null;
  }

  // Asset Allocation per native currency
  const assetClassMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
  const assetAllocationByCurrency: Record<string, AssetAllocationItem[]> = {};

  for (const h of rawHoldings) {
    const code = h.currency.toUpperCase();
    if (!assetAllocationByCurrency[code]) assetAllocationByCurrency[code] = [];
    const ac = assetClassMap.get(h.assetClassId);
    const mv = resolveHoldingMarketValue(h);
    const cb = roundCurrencyAmount(
      h.remainingCostBasis ?? h.quantity * (h.averageCostPerUnit || 0),
      code
    );
    const realized = roundCurrencyAmount(h.realizedPnlTotal ?? 0, code);

    let item = assetAllocationByCurrency[code].find((x) => x.assetClassId === h.assetClassId);
    if (!item) {
      item = {
        assetClassId: h.assetClassId,
        assetClassName: ac?.name ?? 'Uncategorized',
        assetClassCode: ac?.code ?? 'OTHER',
        currency: code,
        marketValue: 0,
        costBasis: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalPnl: 0,
        percentageOfCurrencyHoldings: 0,
        holdingCount: 0,
      };
      assetAllocationByCurrency[code].push(item);
    }

    item.holdingCount += 1;
    item.marketValue = roundCurrencyAmount(addDecimal(item.marketValue, mv), code);
    item.costBasis = roundCurrencyAmount(addDecimal(item.costBasis, cb), code);
    item.unrealizedPnl = roundCurrencyAmount(subtractDecimal(item.marketValue, item.costBasis), code);
    item.realizedPnl = roundCurrencyAmount(addDecimal(item.realizedPnl, realized), code);
    item.totalPnl = roundCurrencyAmount(addDecimal(item.unrealizedPnl, item.realizedPnl), code);
  }

  for (const [code, list] of Object.entries(assetAllocationByCurrency)) {
    const totalMv = list.reduce((sum, item) => addDecimal(sum, item.marketValue), 0);
    for (const item of list) {
      item.percentageOfCurrencyHoldings =
        totalMv > 0 ? Math.round((item.marketValue / totalMv) * 10000) / 100 : 0;
    }
    list.sort((a, b) => b.marketValue - a.marketValue);
    if (list.length === 0) delete assetAllocationByCurrency[code];
  }

  // Converted Base-Currency Totals (strictly using recorded manual FX rates; never assumed!)
  const currencies = Object.keys(byCurrency).sort((a, b) =>
    a === baseCurrency ? -1 : b === baseCurrency ? 1 : a.localeCompare(b)
  );
  const missingCurrencies: string[] = [];
  const appliedRates: ManualFxRateEntry[] = [];

  for (const code of currencies) {
    if (code === baseCurrency) continue;
    const rate = findManualFxRate(manualFxRates, code, baseCurrency);
    if (!rate) {
      missingCurrencies.push(code);
    } else {
      appliedRates.push(rate);
    }
  }

  let convertedInvestmentValue = 0;
  let convertedNetContrib = 0;
  let convertedHoldingsMv = 0;
  let convertedCostBasis = 0;
  let convertedUnrealized = 0;
  let convertedRealized = 0;
  let convertedTotalGain = 0;
  let convertedNetWorth = 0;
  const canConvertAll = missingCurrencies.length === 0;

  if (canConvertAll) {
    for (const bucket of Object.values(byCurrency)) {
      const rate = findManualFxRate(manualFxRates, bucket.currency, baseCurrency)!;
      const cv = (amt: number) =>
        convertCurrencyWithManualRate(amt, bucket.currency, baseCurrency, rate).convertedAmount;

      convertedInvestmentValue = roundCurrencyAmount(
        addDecimal(convertedInvestmentValue, cv(bucket.totalInvestmentValue)),
        baseCurrency
      );
      convertedNetContrib = roundCurrencyAmount(
        addDecimal(convertedNetContrib, cv(bucket.netContributions)),
        baseCurrency
      );
      convertedHoldingsMv = roundCurrencyAmount(
        addDecimal(convertedHoldingsMv, cv(bucket.holdingsMarketValue)),
        baseCurrency
      );
      convertedCostBasis = roundCurrencyAmount(
        addDecimal(convertedCostBasis, cv(bucket.remainingCostBasis)),
        baseCurrency
      );
      convertedUnrealized = roundCurrencyAmount(
        addDecimal(convertedUnrealized, cv(bucket.unrealizedPnl)),
        baseCurrency
      );
      convertedRealized = roundCurrencyAmount(
        addDecimal(convertedRealized, cv(bucket.realizedPnl)),
        baseCurrency
      );
      convertedTotalGain = roundCurrencyAmount(
        addDecimal(convertedTotalGain, cv(bucket.totalInvestmentGainLoss)),
        baseCurrency
      );
    }

    for (const nw of Object.values(netWorth.byCurrency)) {
      const rate = findManualFxRate(manualFxRates, nw.currency, baseCurrency);
      if (rate) {
        const val = convertCurrencyWithManualRate(
          nw.totalNetWorth,
          nw.currency,
          baseCurrency,
          rate
        ).convertedAmount;
        convertedNetWorth = roundCurrencyAmount(addDecimal(convertedNetWorth, val), baseCurrency);
      }
    }
  }

  const convertedAssetAllocationMap = new Map<
    string,
    {
      assetClassId: string;
      assetClassName: string;
      assetClassCode: string;
      convertedMarketValue: number;
      convertedCostBasis: number;
      convertedPnl: number;
      percentage: number;
    }
  >();

  if (canConvertAll) {
    for (const items of Object.values(assetAllocationByCurrency)) {
      for (const item of items) {
        const rate = findManualFxRate(manualFxRates, item.currency, baseCurrency)!;
        const mv = convertCurrencyWithManualRate(
          item.marketValue,
          item.currency,
          baseCurrency,
          rate
        ).convertedAmount;
        const cb = convertCurrencyWithManualRate(
          item.costBasis,
          item.currency,
          baseCurrency,
          rate
        ).convertedAmount;
        const pnl = convertCurrencyWithManualRate(
          item.totalPnl,
          item.currency,
          baseCurrency,
          rate
        ).convertedAmount;

        const existing = convertedAssetAllocationMap.get(item.assetClassId) ?? {
          assetClassId: item.assetClassId,
          assetClassName: item.assetClassName,
          assetClassCode: item.assetClassCode,
          convertedMarketValue: 0,
          convertedCostBasis: 0,
          convertedPnl: 0,
          percentage: 0,
        };
        existing.convertedMarketValue = roundCurrencyAmount(
          addDecimal(existing.convertedMarketValue, mv),
          baseCurrency
        );
        existing.convertedCostBasis = roundCurrencyAmount(
          addDecimal(existing.convertedCostBasis, cb),
          baseCurrency
        );
        existing.convertedPnl = roundCurrencyAmount(
          addDecimal(existing.convertedPnl, pnl),
          baseCurrency
        );
        convertedAssetAllocationMap.set(item.assetClassId, existing);
      }
    }
  }

  const convertedAssetAllocation = Array.from(convertedAssetAllocationMap.values())
    .map((slice) => ({
      ...slice,
      percentage:
        convertedHoldingsMv > 0
          ? Math.round((slice.convertedMarketValue / convertedHoldingsMv) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.convertedMarketValue - a.convertedMarketValue);

  const convertedUnrealizedPct =
    convertedCostBasis > 0 ? roundUnitPrice((convertedUnrealized / convertedCostBasis) * 100) : null;

  return {
    baseCurrency,
    currencies,
    byCurrency,
    convertedTotals: {
      baseCurrency,
      canConvertAll,
      missingCurrencies,
      appliedRates,
      totalInvestmentValue: convertedInvestmentValue,
      netContributions: convertedNetContrib,
      holdingsMarketValue: convertedHoldingsMv,
      remainingCostBasis: convertedCostBasis,
      unrealizedPnl: convertedUnrealized,
      unrealizedPnlPct: convertedUnrealizedPct,
      realizedPnl: convertedRealized,
      totalInvestmentGainLoss: convertedTotalGain,
      totalNetWorth: convertedNetWorth,
    },
    assetAllocationByCurrency,
    convertedAssetAllocation,
    platforms,
    holdings: holdingsEnriched,
    recentActivities: activitiesEnriched,
    netWorth,
  };
}
