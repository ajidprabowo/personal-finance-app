import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { isValidDateString, nowIso, todayDateString } from '@/lib/dates';
import { DatabaseError, SafetyGuardError, ValidationError } from '@/lib/errors';
import { getManualFxRates, findManualFxRate, convertCurrencyWithManualRate } from '@/services/portfolio-valuation.service';
import { getAccountBalancesSnapshot } from '@/services/account-balance.service';
import {
  addDecimal,
  divideDecimal,
  multiplyDecimal,
  roundQuantity,
  roundUnitPrice,
  subtractDecimal,
} from '@/lib/precision';
import {
  assetClassesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  investmentPlatformsRepository,
} from '@/repositories';
import {
  computeBuyPositionUpdate,
  computeSellPositionUpdate,
  replayHoldingActivities,
} from '@/services/cost-basis.service';
import type {
  Holding,
  InvestmentActivity,
  InvestmentActivityType,
  PortfolioValuation,
  RecordOrigin,
} from '@/types/entities';

export interface BuyAssetInput {
  platformId: string;
  holdingId: string;
  quantity: number;
  unitPrice: number;
  feeAmount?: number;
  activityDate?: string;
  notes?: string;
}

export interface SellAssetInput {
  platformId: string;
  holdingId: string;
  quantity: number;
  unitPrice: number;
  feeAmount?: number;
  activityDate?: string;
  notes?: string;
}

export interface CashIncomeOrFeeInput {
  platformId: string;
  holdingId?: string;
  amount: number;
  feeAmount?: number;
  activityDate?: string;
  description?: string;
  notes?: string;
}

export interface ValuationUpdateInput {
  holdingId: string;
  unitPrice?: number;
  marketValue?: number;
  valuationDate?: string;
  fxRateToBase?: number;
  fxRateDate?: string;
  baseCurrency?: string;
  /** Kept for input compatibility; manual price updates are always recorded historically. */
  recordSnapshot?: boolean;
  notes?: string;
}

export interface ActivityUpdatePatch {
  activityDate?: string;
  quantity?: number;
  unitPrice?: number;
  grossAmount?: number;
  feeAmount?: number;
  description?: string;
  notes?: string;
}

export interface InvestmentActivityFilters {
  recordOrigin?: RecordOrigin;
  search?: string;
  platformId?: string | 'all';
  assetClassId?: string | 'all';
  holdingId?: string | 'all';
  activityType?: InvestmentActivityType | 'all';
  startDate?: string | null;
  endDate?: string | null;
  sortOrder?: 'newest' | 'oldest';
}

export interface EnrichedInvestmentActivity {
  activity: InvestmentActivity;
  platformName: string;
  holdingSymbol?: string;
  holdingName?: string;
  assetClassId?: string;
  assetClassName?: string;
}

async function applyHoldingReplayInsideTx(
  db: Awaited<ReturnType<typeof ensureDatabaseOpen>>,
  holdingId: string,
  origin: RecordOrigin,
  timestamp: string
): Promise<Holding> {
  const holding = await db.holdings.get(holdingId);
  if (!holding || holding.recordOrigin !== origin) {
    throw new ValidationError('Referenced holding does not exist.');
  }

  const allActivities = await db.investmentActivities
    .where('holdingId')
    .equals(holdingId)
    .toArray();

  const originActivities = allActivities.filter((a) => a.recordOrigin === origin);
  const replayed = replayHoldingActivities(originActivities, holding.currency);

  for (const patch of replayed.activityPatches) {
    await db.investmentActivities.update(patch.id, {
      grossAmount: patch.grossAmount,
      netAmount: patch.netAmount,
      allocatedCostBasis: patch.allocatedCostBasis,
      realizedPnl: patch.realizedPnl,
      updatedAt: timestamp,
    });
  }

  const updatedHolding: Holding = {
    ...holding,
    quantity: replayed.state.quantity,
    remainingCostBasis: replayed.state.remainingCostBasis,
    averageCostPerUnit: replayed.state.averageCostPerUnit,
    realizedPnlTotal: replayed.state.realizedPnlTotal,
    currentPrice: replayed.state.currentPrice,
    priceRecorded: replayed.state.currentPrice !== undefined,
    currentMarketValue:
      replayed.state.quantity === 0
        ? 0
        : replayed.state.currentPrice !== undefined
          ? roundCurrencyAmount(
              multiplyDecimal(replayed.state.quantity, replayed.state.currentPrice),
              holding.currency
            )
          : 0,
    lastValuationDate: replayed.state.lastValuationDate,
    updatedAt: timestamp,
  };

  await db.holdings.put(updatedHolding);
  return updatedHolding;
}

export async function recordBuyActivity(
  input: BuyAssetInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{ activity: InvestmentActivity; holding: Holding }> {
  const origin = options?.recordOrigin ?? 'user';
  const activityDate = input.activityDate || todayDateString();
  if (!isValidDateString(activityDate)) {
    throw new ValidationError('Transaction date must be a valid YYYY-MM-DD calendar date.');
  }

  const cashBalances = await getAccountBalancesSnapshot({ recordOrigin: origin });
  const db = await ensureDatabaseOpen();
  const fxRates = await getManualFxRates();
  return db.transaction(
    'rw',
    [db.investmentPlatforms, db.accounts, db.holdings, db.investmentActivities],
    async () => {
      const [platform, holding] = await Promise.all([
        db.investmentPlatforms.get(input.platformId),
        db.holdings.get(input.holdingId),
      ]);

      if (!platform || platform.recordOrigin !== origin || platform.isArchived) {
        throw new ValidationError('Selected investment platform is disabled or not found.');
      }
      if (!holding || holding.recordOrigin !== origin) {
        throw new ValidationError('Selected holding does not exist.');
      }
      if (holding.platformId !== platform.id) {
        throw new ValidationError('Holding does not belong to the selected platform.');
      }
      if (!platform.cashAccountId) {
        throw new ValidationError(`Platform "${platform.name}" has no linked cash account.`);
      }
      const cashAccount = await db.accounts.get(platform.cashAccountId);
      if (!cashAccount || cashAccount.isArchived) {
        throw new ValidationError(`Platform cash account for "${platform.name}" is inactive.`);
      }

      const fxRate = holding.currency === cashAccount.currency
        ? null
        : findManualFxRate(fxRates, holding.currency, cashAccount.currency, activityDate);
      const fxConversion = holding.currency === cashAccount.currency
        ? null
        : convertCurrencyWithManualRate(1, holding.currency, cashAccount.currency, fxRate);

      const calc = computeBuyPositionUpdate(
        {
          quantity: holding.quantity,
          remainingCostBasis:
            holding.remainingCostBasis ?? holding.quantity * (holding.averageCostPerUnit || 0),
          averageCostPerUnit: holding.averageCostPerUnit,
          realizedPnlTotal: holding.realizedPnlTotal ?? 0,
          currency: holding.currency,
          currentPrice: holding.currentPrice,
        },
        {
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          feeAmount: input.feeAmount,
        }
      );

      const settlementAmount = roundCurrencyAmount(
        fxConversion ? multiplyDecimal(calc.totalCashOutflow, fxConversion.rate) : calc.totalCashOutflow,
        cashAccount.currency
      );
      const available = cashBalances.items.find((item) => item.account.id === cashAccount.id)?.currentBalance ?? 0;
      if (available < settlementAmount) {
        throw new ValidationError(`Insufficient cash in ${platform.name} (${cashAccount.currency}).`);
      }

      const timestamp = nowIso();
      const activity: InvestmentActivity = {
        id: crypto.randomUUID(),
        platformId: platform.id,
        holdingId: holding.id,
        accountId: cashAccount.id,
        activityType: 'buy',
        quantity: roundQuantity(input.quantity),
        unitPrice: roundUnitPrice(input.unitPrice),
        grossAmount: calc.grossAmount,
        feeAmount: calc.feeAmount,
        netAmount: calc.totalCashOutflow,
        currency: holding.currency,
        settlementAmount,
        settlementCurrency: cashAccount.currency,
        settlementFxRate: fxConversion?.rate,
        settlementFxRateDate: fxRate?.date,
        activityDate,
        description: `Buy ${roundQuantity(input.quantity)} ${holding.symbol} @ ${roundUnitPrice(input.unitPrice)}`,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.investmentActivities.add(activity);
      const updatedHolding = await applyHoldingReplayInsideTx(db, holding.id, origin, timestamp);

      return { activity, holding: updatedHolding };
    }
  );
}

export async function recordSellActivity(
  input: SellAssetInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{ activity: InvestmentActivity; holding: Holding }> {
  const origin = options?.recordOrigin ?? 'user';
  const activityDate = input.activityDate || todayDateString();
  if (!isValidDateString(activityDate)) {
    throw new ValidationError('Transaction date must be a valid YYYY-MM-DD calendar date.');
  }

  const cashBalances = await getAccountBalancesSnapshot({ recordOrigin: origin });
  const db = await ensureDatabaseOpen();
  const fxRates = await getManualFxRates();
  return db.transaction(
    'rw',
    [db.investmentPlatforms, db.accounts, db.holdings, db.investmentActivities],
    async () => {
      const [platform, holding] = await Promise.all([
        db.investmentPlatforms.get(input.platformId),
        db.holdings.get(input.holdingId),
      ]);

      if (!platform || platform.recordOrigin !== origin || platform.isArchived) {
        throw new ValidationError('Selected investment platform is disabled or not found.');
      }
      if (!holding || holding.recordOrigin !== origin) {
        throw new ValidationError('Selected holding does not exist.');
      }
      if (holding.platformId !== platform.id) {
        throw new ValidationError('Holding does not belong to the selected platform.');
      }
      if (!platform.cashAccountId) {
        throw new ValidationError(`Platform "${platform.name}" has no linked cash account.`);
      }
      const cashAccount = await db.accounts.get(platform.cashAccountId);
      if (!cashAccount || cashAccount.isArchived) {
        throw new ValidationError(`Platform cash account for "${platform.name}" is inactive.`);
      }

      const fxRate = holding.currency === cashAccount.currency
        ? null
        : findManualFxRate(fxRates, holding.currency, cashAccount.currency, activityDate);
      const fxConversion = holding.currency === cashAccount.currency
        ? null
        : convertCurrencyWithManualRate(1, holding.currency, cashAccount.currency, fxRate);

      const calc = computeSellPositionUpdate(
        {
          quantity: holding.quantity,
          remainingCostBasis:
            holding.remainingCostBasis ?? holding.quantity * (holding.averageCostPerUnit || 0),
          averageCostPerUnit: holding.averageCostPerUnit,
          realizedPnlTotal: holding.realizedPnlTotal ?? 0,
          currency: holding.currency,
        },
        {
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          feeAmount: input.feeAmount,
        }
      );
      const settlementAmount = roundCurrencyAmount(
        fxConversion ? multiplyDecimal(calc.netProceeds, fxConversion.rate) : calc.netProceeds,
        cashAccount.currency
      );
      // Sales add cash and do not require pre-existing cash.
      if (settlementAmount <= 0) {
        throw new ValidationError('Net sale proceeds must be greater than zero after fees.');
      }

      const timestamp = nowIso();
      const activity: InvestmentActivity = {
        id: crypto.randomUUID(),
        platformId: platform.id,
        holdingId: holding.id,
        accountId: cashAccount.id,
        activityType: 'sell',
        quantity: roundQuantity(input.quantity),
        unitPrice: roundUnitPrice(input.unitPrice),
        grossAmount: calc.grossProceeds,
        feeAmount: calc.feeAmount,
        netAmount: calc.netProceeds,
        allocatedCostBasis: calc.allocatedCostBasis,
        realizedPnl: calc.realizedPnl,
        currency: holding.currency,
        settlementAmount,
        settlementCurrency: cashAccount.currency,
        settlementFxRate: fxConversion?.rate,
        settlementFxRateDate: fxRate?.date,
        activityDate,
        description: `Sell ${roundQuantity(input.quantity)} ${holding.symbol} @ ${roundUnitPrice(input.unitPrice)}`,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.investmentActivities.add(activity);
      const updatedHolding = await applyHoldingReplayInsideTx(db, holding.id, origin, timestamp);

      return { activity, holding: updatedHolding };
    }
  );
}

export async function recordDividendActivity(
  input: CashIncomeOrFeeInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentActivity> {
  return recordCashActivity('dividend', input, options);
}

export async function recordInterestActivity(
  input: CashIncomeOrFeeInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentActivity> {
  return recordCashActivity('interest', input, options);
}

export async function recordFeeActivity(
  input: CashIncomeOrFeeInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentActivity> {
  return recordCashActivity('fee', input, options);
}

async function recordCashActivity(
  kind: 'dividend' | 'interest' | 'fee',
  input: CashIncomeOrFeeInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentActivity> {
  const origin = options?.recordOrigin ?? 'user';
  const activityDate = input.activityDate || todayDateString();
  if (!isValidDateString(activityDate)) {
    throw new ValidationError('Activity date must be a valid YYYY-MM-DD calendar date.');
  }

  const db = await ensureDatabaseOpen();
  return db.transaction(
    'rw',
    [db.investmentPlatforms, db.accounts, db.holdings, db.investmentActivities],
    async () => {
      const platform = await db.investmentPlatforms.get(input.platformId);
      if (!platform || platform.recordOrigin !== origin || platform.isArchived) {
        throw new ValidationError('Selected investment platform is disabled or not found.');
      }
      if (!platform.cashAccountId) {
        throw new ValidationError(`Platform "${platform.name}" has no linked cash account.`);
      }

      const cashAccount = await db.accounts.get(platform.cashAccountId);
      if (!cashAccount || cashAccount.isArchived) {
        throw new ValidationError(`Platform cash account for "${platform.name}" is inactive.`);
      }

      let holding: Holding | undefined;
      if (input.holdingId) {
        holding = await db.holdings.get(input.holdingId);
        if (!holding || holding.recordOrigin !== origin || holding.platformId !== platform.id) {
          throw new ValidationError('Selected holding does not match this platform.');
        }
      }

      const currency = holding?.currency ?? cashAccount.currency;
      const amount = roundCurrencyAmount(Number(input.amount), currency);
      const feeAmount = roundCurrencyAmount(Math.max(0, Number(input.feeAmount ?? 0)), currency);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than zero.');
      }
      if (kind !== 'fee' && feeAmount >= amount) {
        throw new ValidationError('Withholding fee/tax cannot equal or exceed gross income.');
      }

      const netAmount =
        kind === 'fee'
          ? amount
          : roundCurrencyAmount(Math.max(0, subtractDecimal(amount, feeAmount)), currency);

      const defaultDesc =
        kind === 'dividend'
          ? holding
            ? `Dividend: ${holding.symbol}`
            : `Dividend (${platform.name})`
          : kind === 'interest'
            ? `Interest (${platform.name})`
            : holding
              ? `Platform Fee: ${holding.symbol}`
              : `Platform Fee (${platform.name})`;

      const timestamp = nowIso();
      const activity: InvestmentActivity = {
        id: crypto.randomUUID(),
        platformId: platform.id,
        holdingId: holding?.id,
        accountId: cashAccount.id,
        activityType: kind,
        grossAmount: kind === 'fee' ? 0 : amount,
        feeAmount: kind === 'fee' ? amount : feeAmount,
        netAmount,
        currency,
        activityDate,
        description: input.description?.trim() || defaultDesc,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.investmentActivities.add(activity);
      return activity;
    }
  );
}

/**
 * Updates market valuation for a holding without modifying quantity, cost basis, or cash balance.
 */
export async function recordValuationUpdateActivity(
  input: ValuationUpdateInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{
  holding: Holding;
  activity: InvestmentActivity;
  snapshot?: PortfolioValuation;
}> {
  const origin = options?.recordOrigin ?? 'user';
  const valuationDate = input.valuationDate || todayDateString();
  if (!isValidDateString(valuationDate)) {
    throw new ValidationError('Valuation date must be a valid YYYY-MM-DD calendar date.');
  }

  const db = await ensureDatabaseOpen();
  return db.transaction(
    'rw',
    [db.holdings, db.investmentActivities, db.portfolioValuations],
    async () => {
      const holding = await db.holdings.get(input.holdingId);
      if (!holding || holding.recordOrigin !== origin) {
        throw new ValidationError('Holding record not found.');
      }

      let nextUnitPrice: number;
      let nextMarketValue: number;

      if (input.unitPrice !== undefined) {
        if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
          throw new ValidationError('Market price must be zero or greater.');
        }
        nextUnitPrice = roundUnitPrice(input.unitPrice);
        nextMarketValue = roundCurrencyAmount(
          multiplyDecimal(holding.quantity, nextUnitPrice),
          holding.currency
        );
      } else if (input.marketValue !== undefined) {
        if (!Number.isFinite(input.marketValue) || input.marketValue < 0) {
          throw new ValidationError('Market value must be zero or greater.');
        }
        nextMarketValue = roundCurrencyAmount(input.marketValue, holding.currency);
        nextUnitPrice =
          holding.quantity > 0
            ? roundUnitPrice(divideDecimal(nextMarketValue, holding.quantity, 6))
            : 0;
      } else {
        throw new ValidationError('Provide either a unit market price or a total market value.');
      }

      const timestamp = nowIso();
      const activity: InvestmentActivity = {
        id: crypto.randomUUID(),
        platformId: holding.platformId,
        holdingId: holding.id,
        activityType: 'valuation_update',
        quantity: holding.quantity,
        unitPrice: nextUnitPrice,
        grossAmount: nextMarketValue,
        feeAmount: 0,
        netAmount: nextMarketValue,
        currency: holding.currency,
        fxRateToBase: input.fxRateToBase ? roundUnitPrice(input.fxRateToBase) : undefined,
        fxRateDate: input.fxRateToBase ? input.fxRateDate || valuationDate : undefined,
        fxBaseCurrency: input.fxRateToBase
          ? (input.baseCurrency || APP_CONFIG.defaultCurrency).toUpperCase()
          : undefined,
        activityDate: valuationDate,
        description: `Valuation Update: ${holding.symbol} @ ${nextUnitPrice}`,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.investmentActivities.add(activity);

      // Replay makes the latest dated manual price the active valuation, including
      // when a user records a historical price after a newer one.
      const allActivities = await db.investmentActivities
        .where('holdingId')
        .equals(holding.id)
        .toArray();
      const replayed = replayHoldingActivities(
        allActivities.filter((item) => item.recordOrigin === origin),
        holding.currency
      );
      const updatedHolding: Holding = {
        ...holding,
        quantity: replayed.state.quantity,
        remainingCostBasis: replayed.state.remainingCostBasis,
        averageCostPerUnit: replayed.state.averageCostPerUnit,
        realizedPnlTotal: replayed.state.realizedPnlTotal,
        currentPrice: replayed.state.currentPrice,
        priceRecorded: replayed.state.currentPrice !== undefined,
        currentMarketValue: replayed.state.currentMarketValue,
        lastValuationDate: replayed.state.lastValuationDate,
        updatedAt: timestamp,
      };
      await db.holdings.put(updatedHolding);

      let snapshot: PortfolioValuation;
      {
        const baseCurrency = input.baseCurrency?.toUpperCase();
        const convertedMarketValue =
          input.fxRateToBase && input.fxRateToBase > 0
            ? roundCurrencyAmount(
                multiplyDecimal(nextMarketValue, input.fxRateToBase),
                baseCurrency || APP_CONFIG.defaultCurrency
              )
            : baseCurrency === holding.currency
              ? nextMarketValue
              : undefined;

        snapshot = {
          id: crypto.randomUUID(),
          scope: 'holding',
          platformId: holding.platformId,
          holdingId: holding.id,
          valuationDate,
          unitPrice: nextUnitPrice,
          marketValue: nextMarketValue,
          costBasis:
            replayed.state.remainingCostBasis ??
            roundCurrencyAmount(
              multiplyDecimal(holding.quantity, holding.averageCostPerUnit || 0),
              holding.currency
            ),
          currency: holding.currency,
          fxRateToBase: input.fxRateToBase ? roundUnitPrice(input.fxRateToBase) : undefined,
          fxRateDate: input.fxRateToBase ? input.fxRateDate || valuationDate : undefined,
          baseCurrency,
          convertedMarketValue,
          notes: input.notes?.trim() || undefined,
          source: 'manual',
          isTestData: origin === 'test',
          recordOrigin: origin,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await db.portfolioValuations.add(snapshot);
      }

      return { holding: updatedHolding, activity, snapshot };
    }
  );
}

/**
 * Controlled atomic edit of an existing investment activity.
 * Updates linked transfers OR replays affected holding cost-basis & realized P/L chronologically,
 * automatically rolling back if the edit would leave an invalid oversold holding state.
 */
export async function updateInvestmentActivity(
  id: string,
  patch: ActivityUpdatePatch,
  options?: { recordOrigin?: RecordOrigin }
): Promise<InvestmentActivity> {
  const origin = options?.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  return db.transaction(
    'rw',
    [db.investmentActivities, db.holdings, db.transactions],
    async () => {
      const existing = await db.investmentActivities.get(id);
      if (!existing) {
        throw new DatabaseError(`Investment activity "${id}" was not found.`);
      }
      if (existing.recordOrigin !== origin) {
        throw new SafetyGuardError('Cannot edit an activity from a different data origin.');
      }

      const nextDate = patch.activityDate ?? existing.activityDate;
      if (!isValidDateString(nextDate)) {
        throw new ValidationError('Activity date must be a valid YYYY-MM-DD calendar date.');
      }

      const timestamp = nowIso();
      const nextNotes =
        patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes;
      const nextDescription =
        patch.description !== undefined ? patch.description.trim() : existing.description;

      if (
        existing.activityType === 'contribution' ||
        existing.activityType === 'withdrawal' ||
        existing.activityType === 'platform_transfer'
      ) {
        const nextAmount = roundCurrencyAmount(
          Number(patch.grossAmount ?? existing.grossAmount),
          existing.currency
        );
        if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
          throw new ValidationError('Transfer amount must be greater than zero.');
        }

        if (existing.linkedTransactionId) {
          const linkedTx = await db.transactions.get(existing.linkedTransactionId);
          if (linkedTx) {
            await db.transactions.put({
              ...linkedTx,
              amount: nextAmount,
              date: nextDate,
              description: nextDescription || linkedTx.description,
              notes: nextNotes,
              updatedAt: timestamp,
            });
          }
        }

        const updated: InvestmentActivity = {
          ...existing,
          activityDate: nextDate,
          grossAmount: nextAmount,
          netAmount: nextAmount,
          description: nextDescription || existing.description,
          notes: nextNotes,
          updatedAt: timestamp,
        };
        await db.investmentActivities.put(updated);
        return updated;
      }

      if (existing.activityType === 'buy' || existing.activityType === 'sell' || existing.activityType === 'partial_sell') {
        const nextQty = roundQuantity(Number(patch.quantity ?? existing.quantity ?? 0));
        const nextUnitPrice = roundUnitPrice(Number(patch.unitPrice ?? existing.unitPrice ?? 0));
        const nextFee = roundCurrencyAmount(
          Math.max(0, Number(patch.feeAmount ?? existing.feeAmount ?? 0)),
          existing.currency
        );

        if (!Number.isFinite(nextQty) || nextQty <= 0) {
          throw new ValidationError('Quantity must be greater than zero.');
        }
        if (!Number.isFinite(nextUnitPrice) || nextUnitPrice < 0) {
          throw new ValidationError('Unit price must be zero or greater.');
        }

        const gross = roundCurrencyAmount(multiplyDecimal(nextQty, nextUnitPrice), existing.currency);
        const net =
          existing.activityType === 'buy'
            ? roundCurrencyAmount(addDecimal(gross, nextFee), existing.currency)
            : roundCurrencyAmount(subtractDecimal(gross, nextFee), existing.currency);

        const settlementAmount = existing.settlementCurrency && existing.settlementCurrency !== existing.currency
          ? roundCurrencyAmount(
              multiplyDecimal(net, existing.settlementFxRate ?? 1),
              existing.settlementCurrency
            )
          : net;

        const updated: InvestmentActivity = {
          ...existing,
          activityDate: nextDate,
          quantity: nextQty,
          unitPrice: nextUnitPrice,
          grossAmount: gross,
          feeAmount: nextFee,
          netAmount: net,
          settlementAmount,
          description: nextDescription || existing.description,
          notes: nextNotes,
          updatedAt: timestamp,
        };
        await db.investmentActivities.put(updated);

        if (existing.holdingId) {
          await applyHoldingReplayInsideTx(db, existing.holdingId, origin, timestamp);
        }
        return (await db.investmentActivities.get(id)) ?? updated;
      }

      if (existing.activityType === 'valuation_update' || existing.activityType === 'valuation_adjustment') {
        const nextPrice =
          patch.unitPrice !== undefined ? roundUnitPrice(patch.unitPrice) : existing.unitPrice;
        const nextGross =
          patch.grossAmount !== undefined
            ? roundCurrencyAmount(patch.grossAmount, existing.currency)
            : existing.grossAmount;
        if (nextPrice !== undefined && nextPrice < 0) {
          throw new ValidationError('Market price must be zero or greater.');
        }
        const updated: InvestmentActivity = {
          ...existing,
          activityDate: nextDate,
          unitPrice: nextPrice,
          grossAmount: nextGross,
          netAmount: nextGross,
          description: nextDescription || existing.description,
          notes: nextNotes,
          updatedAt: timestamp,
        };
        await db.investmentActivities.put(updated);
        if (existing.holdingId) {
          await applyHoldingReplayInsideTx(db, existing.holdingId, origin, timestamp);
        }
        return (await db.investmentActivities.get(id)) ?? updated;
      }

      // Dividend / interest / fee
      const nextGross = roundCurrencyAmount(
        Math.max(0, Number(patch.grossAmount ?? existing.grossAmount)),
        existing.currency
      );
      const nextFee = roundCurrencyAmount(
        Math.max(0, Number(patch.feeAmount ?? existing.feeAmount)),
        existing.currency
      );
      if (existing.activityType === 'fee' && nextFee <= 0 && nextGross <= 0) {
        throw new ValidationError('Fee amount must be greater than zero.');
      }
      if (existing.activityType !== 'fee' && nextGross <= 0) {
        throw new ValidationError('Income amount must be greater than zero.');
      }

      const updated: InvestmentActivity = {
        ...existing,
        activityDate: nextDate,
        grossAmount: existing.activityType === 'fee' ? 0 : nextGross,
        feeAmount: existing.activityType === 'fee' ? (nextFee > 0 ? nextFee : nextGross) : nextFee,
        netAmount:
          existing.activityType === 'fee'
            ? nextFee > 0
              ? nextFee
              : nextGross
            : roundCurrencyAmount(Math.max(0, subtractDecimal(nextGross, nextFee)), existing.currency),
        description: nextDescription || existing.description,
        notes: nextNotes,
        updatedAt: timestamp,
      };
      await db.investmentActivities.put(updated);
      return updated;
    }
  );
}

/**
 * Controlled atomic deletion of a historical investment activity.
 * Removes linked transfer transaction if applicable, or replays the affected holding
 * and rolls back atomically if deletion would create an oversold holding state.
 */
export async function deleteInvestmentActivity(
  id: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<void> {
  const origin = options?.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  await db.transaction(
    'rw',
    [db.investmentActivities, db.holdings, db.transactions],
    async () => {
      const existing = await db.investmentActivities.get(id);
      if (!existing) return;
      if (existing.recordOrigin !== origin) {
        throw new SafetyGuardError('Cannot delete an activity from a different data origin.');
      }

      if (existing.linkedTransactionId) {
        const linkedTx = await db.transactions.get(existing.linkedTransactionId);
        if (linkedTx && linkedTx.recordOrigin === origin) {
          await db.transactions.delete(linkedTx.id);
        }
      } else if (existing.transferGroupId) {
        const groupRows = await db.transactions
          .where('transferGroupId')
          .equals(existing.transferGroupId)
          .toArray();
        const idsToDelete = groupRows.filter((r) => r.recordOrigin === origin).map((r) => r.id);
        if (idsToDelete.length > 0) {
          await db.transactions.bulkDelete(idsToDelete);
        }
      }

      await db.investmentActivities.delete(id);

      if (
        existing.holdingId &&
        (existing.activityType === 'buy' ||
          existing.activityType === 'sell' ||
          existing.activityType === 'partial_sell' ||
          existing.activityType === 'valuation_update' ||
          existing.activityType === 'valuation_adjustment')
      ) {
        await applyHoldingReplayInsideTx(db, existing.holdingId, origin, nowIso());
      }
    }
  );
}

export async function listInvestmentActivitiesFiltered(
  filters: InvestmentActivityFilters = {}
): Promise<EnrichedInvestmentActivity[]> {
  const origin = filters.recordOrigin ?? 'user';
  const [activities, platforms, holdings, assetClasses] = await Promise.all([
    investmentActivitiesRepository.getByOriginAndDateRange(
      origin,
      filters.startDate ?? null,
      filters.endDate ?? null
    ),
    origin === 'test'
      ? investmentPlatformsRepository.getTestRecords()
      : investmentPlatformsRepository.getUserRecords(),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
    origin === 'test'
      ? assetClassesRepository.getTestRecords()
      : assetClassesRepository.getUserRecords(),
  ]);

  const platformMap = new Map(platforms.map((p) => [p.id, p]));
  const holdingMap = new Map(holdings.map((h) => [h.id, h]));
  const assetClassMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
  const searchLower = filters.search?.trim().toLowerCase() ?? '';

  const result: EnrichedInvestmentActivity[] = [];

  for (const act of activities) {
    if (
      filters.platformId &&
      filters.platformId !== 'all' &&
      act.platformId !== filters.platformId
    ) {
      continue;
    }
    if (filters.holdingId && filters.holdingId !== 'all' && act.holdingId !== filters.holdingId) {
      continue;
    }
    if (filters.activityType && filters.activityType !== 'all') {
      if (filters.activityType === 'sell') {
        if (act.activityType !== 'sell' && act.activityType !== 'partial_sell') continue;
      } else if (act.activityType !== filters.activityType) {
        continue;
      }
    }

    const holding = act.holdingId ? holdingMap.get(act.holdingId) : undefined;
    const assetClass = holding ? assetClassMap.get(holding.assetClassId) : undefined;

    if (
      filters.assetClassId &&
      filters.assetClassId !== 'all' &&
      holding?.assetClassId !== filters.assetClassId
    ) {
      continue;
    }

    const platform = act.platformId ? platformMap.get(act.platformId) : undefined;
    const platformName =
      platform?.name ??
      (act.activityType === 'contribution' || act.activityType === 'withdrawal'
        ? 'Investment Pool'
        : 'Unknown Platform');

    if (searchLower) {
      const descMatch = (act.description ?? '').toLowerCase().includes(searchLower);
      const notesMatch = (act.notes ?? '').toLowerCase().includes(searchLower);
      const symMatch = (holding?.symbol ?? '').toLowerCase().includes(searchLower);
      const nameMatch = (holding?.name ?? '').toLowerCase().includes(searchLower);
      const platMatch = platformName.toLowerCase().includes(searchLower);
      if (!descMatch && !notesMatch && !symMatch && !nameMatch && !platMatch) continue;
    }

    result.push({
      activity: act,
      platformName,
      holdingSymbol: holding?.symbol,
      holdingName: holding?.name,
      assetClassId: assetClass?.id,
      assetClassName: assetClass?.name,
    });
  }

  const sortOrder = filters.sortOrder ?? 'newest';
  result.sort((a, b) => {
    const dateCmp =
      sortOrder === 'newest'
        ? b.activity.activityDate.localeCompare(a.activity.activityDate)
        : a.activity.activityDate.localeCompare(b.activity.activityDate);
    if (dateCmp !== 0) return dateCmp;
    return sortOrder === 'newest'
      ? b.activity.createdAt.localeCompare(a.activity.createdAt)
      : a.activity.createdAt.localeCompare(b.activity.createdAt);
  });

  return result;
}
