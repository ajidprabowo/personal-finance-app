import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { ValidationError } from '@/lib/errors';
import { ensureDatabaseOpen } from '@/database/client';
import { roundUnitPrice } from '@/lib/precision';
import {
  assetClassesRepository,
  holdingsRepository,
  investmentPlatformsRepository,
} from '@/repositories';
import { resolveHoldingMarketValue } from '@/services/account-balance.service';
import { computeUnrealizedPnl } from '@/services/cost-basis.service';
import type { Holding, RecordOrigin } from '@/types/entities';

export interface CreateHoldingInput {
  symbol: string;
  name: string;
  assetClassId: string;
  platformId: string;
  currency?: string;
  notes?: string;
}

export interface HoldingEnriched {
  holding: Holding;
  platformName: string;
  platformArchived: boolean;
  assetClassName: string;
  assetClassCode: string;
  assetClassArchived: boolean;
  quantity: number;
  averageCostPerUnit: number;
  remainingCostBasis: number;
  currentPrice: number | null;
  priceRecorded: boolean;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
  realizedPnlTotal: number;
}

export interface HoldingListFilters {
  recordOrigin?: RecordOrigin;
  search?: string;
  platformId?: string | 'all';
  assetClassId?: string | 'all';
  currency?: string | 'all';
  includeZeroQuantity?: boolean;
  sortBy?: 'value_desc' | 'value_asc' | 'pnl_desc' | 'symbol_asc';
}

export async function createHolding(
  input: CreateHoldingInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<Holding> {
  const origin = options?.recordOrigin ?? 'user';
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name.trim();

  if (!symbol) {
    throw new ValidationError('Asset symbol / ticker is required.');
  }
  if (!name) {
    throw new ValidationError('Asset name is required.');
  }

  const [platform, assetClass, existingHoldings] = await Promise.all([
    investmentPlatformsRepository.getById(input.platformId),
    assetClassesRepository.getById(input.assetClassId),
    holdingsRepository.getByPlatformId(input.platformId),
  ]);

  if (!platform || platform.recordOrigin !== origin) {
    throw new ValidationError('Selected investment platform does not exist.');
  }
  if (platform.isArchived) {
    throw new ValidationError(`Platform "${platform.name}" is disabled.`);
  }
  if (!assetClass || assetClass.recordOrigin !== origin) {
    throw new ValidationError('Selected asset class does not exist.');
  }
  if (assetClass.isArchived) {
    throw new ValidationError(`Asset class "${assetClass.name}" is disabled.`);
  }

  const currency = (
    input.currency?.trim() ||
    platform.defaultCurrency ||
    APP_CONFIG.defaultCurrency
  ).toUpperCase();

  // Prevent duplicate identical holding on the same platform & currency while allowing
  // the same symbol across different platforms.
  const duplicate = existingHoldings.find(
    (h) =>
      h.recordOrigin === origin &&
      !h.isArchived &&
      h.symbol.toUpperCase() === symbol &&
      h.currency.toUpperCase() === currency
  );
  if (duplicate) {
    throw new ValidationError(
      `Holding "${symbol}" (${currency}) already exists on ${platform.name}.`
    );
  }

  return holdingsRepository.create({
    platformId: platform.id,
    assetClassId: assetClass.id,
    symbol,
    name,
    currency,
    quantity: 0,
    averageCostPerUnit: 0,
    remainingCostBasis: 0,
    currentPrice: undefined,
    currentMarketValue: 0,
    priceRecorded: false,
    realizedPnlTotal: 0,
    isArchived: false,
    notes: input.notes?.trim() || undefined,
    isTestData: origin === 'test',
    recordOrigin: origin,
  });
}

export async function updateHoldingMetadata(
  id: string,
  patch: {
    name?: string;
    symbol?: string;
    assetClassId?: string;
    notes?: string;
    isArchived?: boolean;
  },
  options?: { recordOrigin?: RecordOrigin }
): Promise<Holding> {
  const origin = options?.recordOrigin ?? 'user';
  const existing = await holdingsRepository.getById(id);
  if (!existing || existing.recordOrigin !== origin) {
    throw new ValidationError('Holding record not found.');
  }

  const nextSymbol = patch.symbol !== undefined ? patch.symbol.trim().toUpperCase() : existing.symbol;
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!nextSymbol) throw new ValidationError('Asset symbol is required.');
  if (!nextName) throw new ValidationError('Asset name is required.');

  if (patch.assetClassId && patch.assetClassId !== existing.assetClassId) {
    const ac = await assetClassesRepository.getById(patch.assetClassId);
    if (!ac || ac.recordOrigin !== origin) {
      throw new ValidationError('Selected asset class does not exist.');
    }
  }

  return holdingsRepository.update(id, {
    symbol: nextSymbol,
    name: nextName,
    assetClassId: patch.assetClassId ?? existing.assetClassId,
    notes: patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
    isArchived: patch.isArchived ?? existing.isArchived,
  });
}

/** Permanently removes an unused holding and only its own valuation history. */
export async function deleteHolding(
  id: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<void> {
  const origin = options?.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', [db.holdings, db.investmentActivities, db.portfolioValuations], async () => {
    const holding = await db.holdings.get(id);
    if (!holding || holding.recordOrigin !== origin) {
      throw new ValidationError('Holding record not found.');
    }
    if (holding.quantity !== 0) {
      throw new ValidationError(`Cannot delete ${holding.symbol}: its quantity must be zero first.`);
    }

    const activities = await db.investmentActivities.toArray();
    const blockingTypes = new Set(['buy', 'sell', 'partial_sell', 'dividend', 'fee']);
    if (activities.some((activity) => activity.holdingId === id && activity.recordOrigin === origin && blockingTypes.has(activity.activityType))) {
      throw new ValidationError(
        `Cannot delete ${holding.symbol}: it has related buy, sell, dividend, or fee activity records.`
      );
    }

    const valuations = await db.portfolioValuations.where('holdingId').equals(id).toArray();
    await db.portfolioValuations.bulkDelete(
      valuations.filter((valuation) => valuation.recordOrigin === origin).map((valuation) => valuation.id)
    );
    await db.holdings.delete(id);
  });
}

export function enrichHoldingRecord(
  holding: Holding,
  platformName: string,
  platformArchived: boolean,
  assetClassName: string,
  assetClassCode: string,
  assetClassArchived: boolean
): HoldingEnriched {
  const quantity = Number.isFinite(holding.quantity) ? Math.max(0, holding.quantity) : 0;
  const remainingCostBasis = roundCurrencyAmount(
    holding.remainingCostBasis ?? quantity * (holding.averageCostPerUnit || 0),
    holding.currency
  );
  const averageCostPerUnit =
    quantity > 0
      ? roundUnitPrice(holding.averageCostPerUnit || remainingCostBasis / quantity)
      : 0;
  const marketValue = resolveHoldingMarketValue(holding);
  const priceRecorded = holding.priceRecorded === true;
  const currentPrice =
    priceRecorded && typeof holding.currentPrice === 'number' && Number.isFinite(holding.currentPrice)
      ? holding.currentPrice
      : null;
  const pnl = priceRecorded
    ? computeUnrealizedPnl(marketValue, remainingCostBasis, holding.currency)
    : { marketValue: 0, remainingCostBasis, unrealizedPnl: 0, unrealizedPnlPct: null };

  return {
    holding,
    platformName,
    platformArchived,
    assetClassName,
    assetClassCode,
    assetClassArchived,
    quantity,
    averageCostPerUnit,
    remainingCostBasis: pnl.remainingCostBasis,
    currentPrice,
    priceRecorded,
    marketValue: pnl.marketValue,
    unrealizedPnl: pnl.unrealizedPnl,
    unrealizedPnlPct: pnl.unrealizedPnlPct,
    realizedPnlTotal: roundCurrencyAmount(holding.realizedPnlTotal ?? 0, holding.currency),
  };
}

export async function listHoldingsWithMetrics(
  filters: HoldingListFilters = {}
): Promise<HoldingEnriched[]> {
  const origin = filters.recordOrigin ?? 'user';
  const [holdings, platforms, assetClasses] = await Promise.all([
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
    origin === 'test'
      ? investmentPlatformsRepository.getTestRecords()
      : investmentPlatformsRepository.getUserRecords(),
    origin === 'test'
      ? assetClassesRepository.getTestRecords()
      : assetClassesRepository.getUserRecords(),
  ]);

  const platformMap = new Map(platforms.map((p) => [p.id, p]));
  const assetClassMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
  const searchLower = filters.search?.trim().toLowerCase() ?? '';
  const includeZero = filters.includeZeroQuantity ?? true;

  const enriched: HoldingEnriched[] = [];

  for (const h of holdings) {
    if (!includeZero && h.quantity <= 0) continue;
    if (filters.platformId && filters.platformId !== 'all' && h.platformId !== filters.platformId) {
      continue;
    }
    if (
      filters.assetClassId &&
      filters.assetClassId !== 'all' &&
      h.assetClassId !== filters.assetClassId
    ) {
      continue;
    }
    if (
      filters.currency &&
      filters.currency !== 'all' &&
      h.currency.toUpperCase() !== filters.currency.toUpperCase()
    ) {
      continue;
    }

    const plat = platformMap.get(h.platformId);
    const ac = assetClassMap.get(h.assetClassId);

    if (searchLower) {
      const symbolMatch = h.symbol.toLowerCase().includes(searchLower);
      const nameMatch = h.name.toLowerCase().includes(searchLower);
      const platMatch = (plat?.name ?? '').toLowerCase().includes(searchLower);
      if (!symbolMatch && !nameMatch && !platMatch) continue;
    }

    enriched.push(
      enrichHoldingRecord(
        h,
        plat?.name ?? 'Unknown Platform',
        Boolean(plat?.isArchived),
        ac?.name ?? 'Uncategorized',
        ac?.code ?? 'OTHER',
        Boolean(ac?.isArchived)
      )
    );
  }

  const sortBy = filters.sortBy ?? 'value_desc';
  enriched.sort((a, b) => {
    if (sortBy === 'value_asc') return a.marketValue - b.marketValue;
    if (sortBy === 'pnl_desc') return b.unrealizedPnl - a.unrealizedPnl;
    if (sortBy === 'symbol_asc') return a.holding.symbol.localeCompare(b.holding.symbol);
    return b.marketValue - a.marketValue || a.holding.symbol.localeCompare(b.holding.symbol);
  });

  return enriched;
}
