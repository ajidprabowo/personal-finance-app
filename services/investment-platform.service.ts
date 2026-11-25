import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { nowIso } from '@/lib/dates';
import { SafetyGuardError, ValidationError } from '@/lib/errors';
import { addDecimal, subtractDecimal } from '@/lib/precision';
import {
  assetClassesRepository,
  holdingsRepository,
  investmentPlatformsRepository,
  preferencesRepository,
} from '@/repositories';
import {
  getAccountBalancesSnapshot,
  resolveHoldingMarketValue,
} from '@/services/account-balance.service';
import { computeUnrealizedPnl } from '@/services/cost-basis.service';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import { enrichHoldingRecord, type HoldingEnriched } from '@/services/holding.service';
import {
  listInvestmentActivitiesFiltered,
  type EnrichedInvestmentActivity,
} from '@/services/investment-activity.service';
import type {
  InvestmentActivityType,
  InvestmentPlatform,
  PlatformKind,
  RecordOrigin,
} from '@/types/entities';

export interface PlatformWithMetrics {
  platform: InvestmentPlatform;
  currency: string;
  cashAccountId?: string;
  cashBalance: number;
  holdingsValue: number;
  totalPlatformValue: number;
  remainingCostBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  realizedPnlTotal: number;
  dividendAndInterestTotal: number;
  feesTotal: number;
  holdingCount: number;
  activeHoldingCount: number;
  missingFxCurrencies: string[];
}

export interface PlatformAssetAllocationSlice {
  assetClassId: string;
  assetClassName: string;
  assetClassCode: string;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  percentage: number;
}

export interface PlatformDetailSnapshot {
  summary: PlatformWithMetrics;
  holdings: HoldingEnriched[];
  assetAllocation: PlatformAssetAllocationSlice[];
  activities: EnrichedInvestmentActivity[];
}

export async function createInvestmentPlatformWithCashAccount(
  input: {
    name: string;
    kind: PlatformKind;
    defaultCurrency: string;
    supportsInvestmentPool?: boolean;
    initialCashBalance?: number;
    notes?: string;
  },
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentPlatform> {
  const origin = options?.recordOrigin ?? 'user';
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Platform name is required.');
  }

  const currency = (input.defaultCurrency || APP_CONFIG.defaultCurrency).toUpperCase();
  const initialCash = roundCurrencyAmount(
    Math.max(0, Number(input.initialCashBalance ?? 0) || 0),
    currency
  );
  const db = await ensureDatabaseOpen();
  const timestamp = nowIso();
  const platformId = crypto.randomUUID();
  const cashAccountId = `acc_cash_${platformId}`;

  return db.transaction('rw', [db.investmentPlatforms, db.accounts], async () => {
    const existingAccounts = await db.accounts.toArray();
    await db.accounts.add({
      id: cashAccountId,
      name: `${name} Cash`,
      type: 'investment_cash',
      currency,
      initialBalance: initialCash,
      sortOrder: existingAccounts.reduce((max, account) => Math.max(max, account.sortOrder ?? 0), 0) + 1,
      platformId,
      isInvestmentPool: false,
      isArchived: false,
      notes: `Platform cash account for ${name}.`,
      isTestData: origin === 'test',
      recordOrigin: origin,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const platform: InvestmentPlatform = {
      id: platformId,
      name,
      kind: input.kind,
      defaultCurrency: currency,
      cashAccountId,
      supportsInvestmentPool: input.supportsInvestmentPool ?? true,
      sortOrder: (await db.investmentPlatforms.toArray()).reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 1,
      isDefault: false,
      isArchived: false,
      notes: input.notes?.trim() || undefined,
      isTestData: origin === 'test',
      recordOrigin: origin,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.investmentPlatforms.add(platform);
    return platform;
  });
}

export async function updateInvestmentPlatformInfo(
  id: string,
  patch: {
    name: string;
    kind: PlatformKind;
    defaultCurrency: string;
    supportsInvestmentPool: boolean;
    isArchived: boolean;
    notes?: string;
  },
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentPlatform> {
  const origin = options?.recordOrigin ?? 'user';
  const existing = await investmentPlatformsRepository.getById(id);
  if (!existing || existing.recordOrigin !== origin) {
    throw new ValidationError('Investment platform not found.');
  }

  const name = patch.name.trim();
  if (!name) {
    throw new ValidationError('Platform name is required.');
  }
  const nextCurrency = patch.defaultCurrency.toUpperCase();
  const db = await ensureDatabaseOpen();
  const timestamp = nowIso();

  return db.transaction(
    'rw',
    [db.investmentPlatforms, db.accounts, db.transactions, db.investmentActivities, db.holdings],
    async () => {
      if (existing.defaultCurrency !== nextCurrency) {
        const [linkedActs, linkedHoldings] = await Promise.all([
          db.investmentActivities.where('platformId').equals(id).count(),
          db.holdings.where('platformId').equals(id).count(),
        ]);
        if (linkedActs > 0 || linkedHoldings > 0) {
          throw new SafetyGuardError(
            `Cannot change default currency of "${existing.name}" because it already has holdings or activity history.`
          );
        }
      }

      if (existing.cashAccountId) {
        const cashAcc = await db.accounts.get(existing.cashAccountId);
        if (cashAcc) {
          await db.accounts.update(cashAcc.id, {
            name: `${name} Cash`,
            currency: nextCurrency,
            isArchived: patch.isArchived,
            updatedAt: timestamp,
          });
        }
      }

      const updated: InvestmentPlatform = {
        ...existing,
        name,
        kind: patch.kind,
        defaultCurrency: nextCurrency,
        supportsInvestmentPool: patch.supportsInvestmentPool,
        isArchived: patch.isArchived,
        notes: patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
        updatedAt: timestamp,
      };
      await db.investmentPlatforms.put(updated);
      return updated;
    }
  );
}

export async function listPlatformsWithMetrics(options?: {
  includeArchived?: boolean;
  recordOrigin?: RecordOrigin;
}): Promise<PlatformWithMetrics[]> {
  const origin = options?.recordOrigin ?? 'user';
  const [platforms, holdings, balances, activities, preferences] = await Promise.all([
    origin === 'test'
      ? investmentPlatformsRepository.getTestRecords()
      : investmentPlatformsRepository.getUserRecords(),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
    getAccountBalancesSnapshot({ recordOrigin: origin }),
    listInvestmentActivitiesFiltered({ recordOrigin: origin }),
    preferencesRepository.getAll(),
  ]);
  const manualFxRates = preferences[0]?.manualFxRates ?? [];

  const filteredPlatforms =
    options?.includeArchived === false ? platforms.filter((p) => !p.isArchived) : platforms;

  const metrics: PlatformWithMetrics[] = filteredPlatforms
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    .map((platform) => {
      const currency = platform.defaultCurrency.toUpperCase();
      const missingFxCurrencies = new Set<string>();
      const convert = (amount: number, fromCurrency: string): number | null => {
        const from = fromCurrency.toUpperCase();
        if (from === currency) return roundCurrencyAmount(amount, currency);
        if (amount === 0) return 0;
        const rate = findManualFxRate(manualFxRates, from, currency);
        if (!rate) {
          missingFxCurrencies.add(from);
          return null;
        }
        return convertCurrencyWithManualRate(amount, from, currency, rate).convertedAmount;
      };
      const platformCashItems = balances.items.filter(
        (item) =>
          item.account.platformId === platform.id && item.account.type === 'investment_cash'
      );
      let cashBalance = 0;
      for (const cashItem of platformCashItems) {
        const converted = convert(cashItem.currentBalance, cashItem.account.currency);
        if (converted !== null) {
          cashBalance = roundCurrencyAmount(addDecimal(cashBalance, converted), currency);
        }
      }

      const platHoldings = holdings.filter((h) => h.platformId === platform.id);
      let holdingsValue = 0;
      let remainingCostBasis = 0;
      let pricedRemainingCostBasis = 0;
      let realizedPnlTotal = 0;
      let activeHoldingCount = 0;

      for (const h of platHoldings) {
        if (h.quantity > 0) activeHoldingCount += 1;
        const mv = resolveHoldingMarketValue(h);
        const cb = roundCurrencyAmount(
          h.remainingCostBasis ?? h.quantity * (h.averageCostPerUnit || 0),
          h.currency
        );
        const convertedMv = convert(mv, h.currency);
        const convertedCb = convert(cb, h.currency);
        if (convertedMv !== null && convertedCb !== null) {
          holdingsValue = roundCurrencyAmount(addDecimal(holdingsValue, convertedMv), currency);
          remainingCostBasis = roundCurrencyAmount(
            addDecimal(remainingCostBasis, convertedCb),
            currency
          );
          if (h.priceRecorded === true) {
            pricedRemainingCostBasis = roundCurrencyAmount(
              addDecimal(pricedRemainingCostBasis, convertedCb),
              currency
            );
          }
          realizedPnlTotal = roundCurrencyAmount(
            addDecimal(realizedPnlTotal, convert(h.realizedPnlTotal ?? 0, h.currency) ?? 0),
            currency
          );
        }
      }

      let dividendAndInterestTotal = 0;
      let feesTotal = 0;
      for (const item of activities) {
        const act = item.activity;
        if (act.platformId !== platform.id) continue;
        const convertActivityAmount = (amount: number) => convert(amount, act.currency);
        if (act.activityType === 'dividend' || act.activityType === 'interest') {
          const net = act.netAmount ?? Math.max(0, subtractDecimal(act.grossAmount, act.feeAmount));
          const convertedNet = convertActivityAmount(net);
          if (convertedNet === null) continue;
          dividendAndInterestTotal = roundCurrencyAmount(
            addDecimal(dividendAndInterestTotal, convertedNet),
            currency
          );
        } else if (act.activityType === 'fee') {
          const convertedFee = convertActivityAmount(act.feeAmount);
          if (convertedFee !== null) {
            feesTotal = roundCurrencyAmount(addDecimal(feesTotal, convertedFee), currency);
          }
        } else if (act.activityType === 'buy' || act.activityType === 'sell' || act.activityType === 'partial_sell') {
          const convertedFee = convertActivityAmount(act.feeAmount);
          if (convertedFee !== null) {
            feesTotal = roundCurrencyAmount(addDecimal(feesTotal, convertedFee), currency);
          }
        }
      }

      const pnl = computeUnrealizedPnl(holdingsValue, pricedRemainingCostBasis, currency);
      const totalPlatformValue = roundCurrencyAmount(
        addDecimal(cashBalance, holdingsValue),
        currency
      );

      return {
        platform,
        currency,
        cashAccountId: platform.cashAccountId,
        cashBalance,
        holdingsValue,
        totalPlatformValue,
        remainingCostBasis,
        unrealizedPnl: pnl.unrealizedPnl,
        unrealizedPnlPct: pnl.unrealizedPnlPct,
        realizedPnlTotal,
        dividendAndInterestTotal,
        feesTotal,
        holdingCount: platHoldings.length,
        activeHoldingCount,
        missingFxCurrencies: Array.from(missingFxCurrencies).sort(),
      };
    });

  return metrics;
}

export async function getPlatformDetail(
  platformId: string,
  options?: {
    activityType?: InvestmentActivityType | 'all';
    startDate?: string | null;
    endDate?: string | null;
    recordOrigin?: RecordOrigin;
  }
): Promise<PlatformDetailSnapshot> {
  const origin = options?.recordOrigin ?? 'user';
  const [allMetrics, holdings, assetClasses, activities, preferences] = await Promise.all([
    listPlatformsWithMetrics({ includeArchived: true, recordOrigin: origin }),
    holdingsRepository.getByPlatformId(platformId),
    origin === 'test'
      ? assetClassesRepository.getTestRecords()
      : assetClassesRepository.getUserRecords(),
    listInvestmentActivitiesFiltered({
      recordOrigin: origin,
      platformId,
      activityType: options?.activityType ?? 'all',
      startDate: options?.startDate ?? null,
      endDate: options?.endDate ?? null,
      sortOrder: 'newest',
    }),
    preferencesRepository.getAll(),
  ]);

  const summary = allMetrics.find((m) => m.platform.id === platformId);
  if (!summary) {
    throw new ValidationError('Investment platform not found.');
  }

  const assetClassMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
  const manualFxRates = preferences[0]?.manualFxRates ?? [];
  const missingFxCurrencies = new Set(summary.missingFxCurrencies);
  const convert = (amount: number, fromCurrency: string): number | null => {
    const from = fromCurrency.toUpperCase();
    if (from === summary.currency) return roundCurrencyAmount(amount, summary.currency);
    const rate = findManualFxRate(manualFxRates, from, summary.currency);
    if (!rate) {
      if (amount !== 0) missingFxCurrencies.add(from);
      return amount === 0 ? 0 : null;
    }
    return convertCurrencyWithManualRate(amount, from, summary.currency, rate).convertedAmount;
  };
  const enrichedHoldings = holdings
    .filter((h) => h.recordOrigin === origin)
    .map((h) => {
      const ac = assetClassMap.get(h.assetClassId);
      return enrichHoldingRecord(
        h,
        summary.platform.name,
        summary.platform.isArchived,
        ac?.name ?? 'Uncategorized',
        ac?.code ?? 'OTHER',
        Boolean(ac?.isArchived)
      );
    })
    .sort((a, b) => b.marketValue - a.marketValue || a.holding.symbol.localeCompare(b.holding.symbol));

  const allocationBuckets = new Map<string, PlatformAssetAllocationSlice>();
  let totalHoldingsValue = 0;

  for (const item of enrichedHoldings) {
    const marketValue = convert(item.marketValue, item.holding.currency);
    const costBasis = item.priceRecorded
      ? convert(item.remainingCostBasis, item.holding.currency)
      : 0;
    if (marketValue === null || costBasis === null) continue;
    totalHoldingsValue = roundCurrencyAmount(
      addDecimal(totalHoldingsValue, marketValue),
      summary.currency
    );

    const existing = allocationBuckets.get(item.holding.assetClassId) ?? {
      assetClassId: item.holding.assetClassId,
      assetClassName: item.assetClassName,
      assetClassCode: item.assetClassCode,
      marketValue: 0,
      costBasis: 0,
      unrealizedPnl: 0,
      percentage: 0,
    };

    existing.marketValue = roundCurrencyAmount(
      addDecimal(existing.marketValue, marketValue),
      summary.currency
    );
    if (item.priceRecorded && costBasis !== null) {
      existing.costBasis = roundCurrencyAmount(
        addDecimal(existing.costBasis, costBasis),
        summary.currency
      );
    }
    existing.unrealizedPnl = roundCurrencyAmount(
      subtractDecimal(existing.marketValue, existing.costBasis),
      summary.currency
    );
    allocationBuckets.set(item.holding.assetClassId, existing);
  }

  const assetAllocation = Array.from(allocationBuckets.values())
    .map((slice) => ({
      ...slice,
      percentage:
        totalHoldingsValue > 0
          ? Math.round((slice.marketValue / totalHoldingsValue) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return {
    summary: { ...summary, missingFxCurrencies: Array.from(missingFxCurrencies).sort() },
    holdings: enrichedHoldings,
    assetAllocation,
    activities,
  };
}
