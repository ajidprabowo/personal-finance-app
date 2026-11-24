import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { isValidDateString, nowIso, todayDateString } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import { multiplyDecimal, roundUnitPrice } from '@/lib/precision';
import { portfolioValuationsRepository, preferencesRepository } from '@/repositories';
import type {
  ManualFxRateEntry,
  PortfolioValuation,
  RecordOrigin,
  ValuationScope,
} from '@/types/entities';

export interface SaveManualFxRateInput {
  id?: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date?: string;
  notes?: string;
}

export interface FxConversionResult {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  convertedAmount: number;
  rate: number;
  rateDate: string;
}

export async function getManualFxRates(): Promise<ManualFxRateEntry[]> {
  const prefs = (await preferencesRepository.getAll())[0];
  return (prefs?.manualFxRates ?? []).map((entry) => ({
    ...entry,
    id: entry.id || `${entry.fromCurrency}_${entry.toCurrency}_${entry.date}`,
    createdAt: entry.createdAt || entry.updatedAt,
  }));
}

export async function saveManualFxRate(input: SaveManualFxRateInput): Promise<ManualFxRateEntry[]> {
  const fromCurrency = input.fromCurrency.trim().toUpperCase();
  const toCurrency = input.toCurrency.trim().toUpperCase();
  const rate = Number(input.rate);
  const date = input.date?.trim() || todayDateString();
  const notes = input.notes?.trim() || undefined;

  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
    throw new ValidationError('Source and target currencies must be valid and distinct.');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ValidationError('FX rate must be a positive number greater than zero.');
  }
  if (!isValidDateString(date)) {
    throw new ValidationError('FX rate effective date must be a valid YYYY-MM-DD calendar date.');
  }

  const prefs = (await preferencesRepository.getAll())[0];
  if (!prefs) {
    throw new ValidationError('User preferences record is not initialized.');
  }

  const existing = prefs.manualFxRates ?? [];
  const timestamp = nowIso();
  const targetById = input.id ? existing.find((e) => e.id === input.id) : undefined;
  const targetByPairAndDate = existing.find(
    (entry) =>
      entry.fromCurrency.toUpperCase() === fromCurrency &&
      entry.toCurrency.toUpperCase() === toCurrency &&
      entry.date === date
  );
  const matched = targetById ?? targetByPairAndDate;

  const nextEntry: ManualFxRateEntry = {
    id: matched?.id || input.id || crypto.randomUUID(),
    fromCurrency,
    toCurrency,
    rate: roundUnitPrice(rate),
    date,
    createdAt: matched?.createdAt || matched?.updatedAt || timestamp,
    updatedAt: timestamp,
    notes: notes ?? matched?.notes,
  };

  // Preserve historical FX entries on other effective dates; replace only the edited id or exact (pair + effectiveDate)
  const filtered = existing.filter((entry) => {
    if (matched?.id && entry.id === matched.id) return false;
    if (
      entry.fromCurrency.toUpperCase() === fromCurrency &&
      entry.toCurrency.toUpperCase() === toCurrency &&
      entry.date === date
    ) {
      return false;
    }
    return true;
  });

  const nextRates = [...filtered, nextEntry].sort(
    (a, b) =>
      a.fromCurrency.localeCompare(b.fromCurrency) ||
      a.toCurrency.localeCompare(b.toCurrency) ||
      b.date.localeCompare(a.date)
  );

  await preferencesRepository.update(prefs.id, { manualFxRates: nextRates });
  return nextRates;
}

export async function removeManualFxRateById(id: string): Promise<ManualFxRateEntry[]> {
  const prefs = (await preferencesRepository.getAll())[0];
  if (!prefs) return [];
  const nextRates = (prefs.manualFxRates ?? []).filter((entry) => entry.id !== id);
  await preferencesRepository.update(prefs.id, { manualFxRates: nextRates });
  return nextRates;
}

export async function removeManualFxRate(
  fromCurrency: string,
  toCurrency: string,
  effectiveDate?: string
): Promise<ManualFxRateEntry[]> {
  const prefs = (await preferencesRepository.getAll())[0];
  if (!prefs) return [];
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  const nextRates = (prefs.manualFxRates ?? []).filter((entry) => {
    const pairMatch =
      entry.fromCurrency.toUpperCase() === from && entry.toCurrency.toUpperCase() === to;
    if (!pairMatch) return true;
    if (effectiveDate) return entry.date !== effectiveDate;
    return false;
  });
  await preferencesRepository.update(prefs.id, { manualFxRates: nextRates });
  return nextRates;
}

export function findManualFxRate(
  rates: ManualFxRateEntry[],
  fromCurrency: string,
  toCurrency: string,
  asOfDate?: string
): ManualFxRateEntry | null {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) {
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: 1,
      date: asOfDate && isValidDateString(asOfDate) ? asOfDate : todayDateString(),
      updatedAt: nowIso(),
    };
  }

  const matching = rates
    .filter(
      (r) =>
        r.fromCurrency.toUpperCase() === from &&
        r.toCurrency.toUpperCase() === to &&
        Number.isFinite(r.rate) &&
        r.rate > 0
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));

  if (matching.length === 0) return null;

  if (asOfDate && isValidDateString(asOfDate)) {
    const onOrBefore = matching.filter((r) => r.date <= asOfDate);
    if (onOrBefore.length > 0) {
      return onOrBefore[onOrBefore.length - 1];
    }
    return matching[0];
  }

  return matching[matching.length - 1];
}

/**
 * Converts a native currency amount strictly using a recorded or explicitly supplied FX rate.
 * Never fabricates or assumes exchange rates.
 */
export function convertCurrencyWithManualRate(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rateEntry: Pick<ManualFxRateEntry, 'rate' | 'date'> | null | undefined
): FxConversionResult {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) {
    return {
      amount,
      fromCurrency: from,
      toCurrency: to,
      convertedAmount: roundCurrencyAmount(amount, to),
      rate: 1,
      rateDate: todayDateString(),
    };
  }

  if (!rateEntry || !Number.isFinite(rateEntry.rate) || rateEntry.rate <= 0) {
    throw new ValidationError(
      `Missing manual FX rate for ${from} -> ${to}. Enter an explicit exchange rate before converting.`
    );
  }

  const convertedAmount = roundCurrencyAmount(multiplyDecimal(amount, rateEntry.rate), to);
  return {
    amount,
    fromCurrency: from,
    toCurrency: to,
    convertedAmount,
    rate: rateEntry.rate,
    rateDate: rateEntry.date,
  };
}

export interface CreateValuationSnapshotInput {
  scope: ValuationScope;
  valuationDate: string;
  marketValue: number;
  costBasis?: number;
  currency: string;
  platformId?: string;
  holdingId?: string;
  unitPrice?: number;
  fxRateToBase?: number;
  fxRateDate?: string;
  baseCurrency?: string;
  notes?: string;
  source?: 'manual' | 'import' | 'computed';
}

export async function createValuationSnapshot(
  input: CreateValuationSnapshotInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<PortfolioValuation> {
  const origin = options?.recordOrigin ?? 'user';
  const currency = (input.currency || APP_CONFIG.defaultCurrency).toUpperCase();
  const valuationDate = input.valuationDate;

  if (!isValidDateString(valuationDate)) {
    throw new ValidationError('Valuation date must be a valid YYYY-MM-DD calendar date.');
  }
  if (!Number.isFinite(input.marketValue) || input.marketValue < 0) {
    throw new ValidationError('Market value must be zero or greater.');
  }

  const marketValue = roundCurrencyAmount(input.marketValue, currency);
  const costBasis =
    input.costBasis !== undefined && Number.isFinite(input.costBasis)
      ? roundCurrencyAmount(Math.max(0, input.costBasis), currency)
      : undefined;

  let convertedMarketValue: number | undefined;
  const targetBaseCurrency = input.baseCurrency?.toUpperCase();

  if (input.fxRateToBase !== undefined) {
    if (!Number.isFinite(input.fxRateToBase) || input.fxRateToBase <= 0) {
      throw new ValidationError('Manual FX rate must be greater than zero.');
    }
    const base = targetBaseCurrency || APP_CONFIG.defaultCurrency;
    convertedMarketValue = roundCurrencyAmount(
      multiplyDecimal(marketValue, input.fxRateToBase),
      base
    );
  } else if (targetBaseCurrency && targetBaseCurrency === currency) {
    convertedMarketValue = marketValue;
  }

  return portfolioValuationsRepository.create({
    scope: input.scope,
    platformId: input.platformId,
    holdingId: input.holdingId,
    valuationDate,
    unitPrice: input.unitPrice !== undefined ? roundUnitPrice(input.unitPrice) : undefined,
    marketValue,
    costBasis,
    currency,
    fxRateToBase: input.fxRateToBase ? roundUnitPrice(input.fxRateToBase) : undefined,
    fxRateDate: input.fxRateToBase ? input.fxRateDate || valuationDate : undefined,
    baseCurrency: targetBaseCurrency,
    convertedMarketValue,
    notes: input.notes?.trim() || undefined,
    source: input.source ?? 'manual',
    isTestData: origin === 'test',
    recordOrigin: origin,
  });
}

export async function listValuationSnapshots(options?: {
  scope?: ValuationScope;
  platformId?: string;
  holdingId?: string;
  recordOrigin?: RecordOrigin;
}): Promise<PortfolioValuation[]> {
  const origin = options?.recordOrigin ?? 'user';
  const rows = await portfolioValuationsRepository.getByOriginSorted(origin);
  return rows.filter((row) => {
    if (options?.scope && row.scope !== options.scope) return false;
    if (options?.platformId && row.platformId !== options.platformId) return false;
    if (options?.holdingId && row.holdingId !== options.holdingId) return false;
    return true;
  });
}

export async function deleteValuationSnapshot(
  id: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<void> {
  const origin = options?.recordOrigin ?? 'user';
  const existing = await portfolioValuationsRepository.getById(id);
  if (!existing || existing.recordOrigin !== origin) {
    throw new ValidationError('Valuation snapshot not found.');
  }
  await portfolioValuationsRepository.delete(id);
}
