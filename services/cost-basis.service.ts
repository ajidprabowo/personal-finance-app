import { getCurrencyDecimals, roundCurrencyAmount } from '@/lib/currency';
import { ValidationError } from '@/lib/errors';
import {
  addDecimal,
  allocateProportionalBasis,
  divideDecimal,
  multiplyDecimal,
  roundQuantity,
  roundUnitPrice,
  subtractDecimal,
} from '@/lib/precision';
import type { InvestmentActivity } from '@/types/entities';

export interface PositionCostState {
  quantity: number;
  remainingCostBasis: number;
  averageCostPerUnit: number;
  realizedPnlTotal: number;
  currency: string;
  currentPrice?: number;
  currentMarketValue?: number;
  lastValuationDate?: string;
}

export interface BuyCalculationResult {
  grossAmount: number;
  feeAmount: number;
  totalCashOutflow: number;
  purchaseCostBasis: number;
  newQuantity: number;
  newRemainingCostBasis: number;
  newAverageCostPerUnit: number;
}

export interface SellCalculationResult {
  grossProceeds: number;
  feeAmount: number;
  netProceeds: number;
  averageCostBeforeSale: number;
  allocatedCostBasis: number;
  realizedPnl: number;
  newQuantity: number;
  newRemainingCostBasis: number;
  newAverageCostPerUnit: number;
}

export interface UnrealizedPnlResult {
  marketValue: number;
  remainingCostBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
}

/**
 * Pure Weighted Average Cost purchase calculation.
 * Purchase Cost Basis includes gross purchase value plus acquisition fees.
 */
export function computeBuyPositionUpdate(
  state: PositionCostState,
  input: {
    quantity: number;
    unitPrice: number;
    feeAmount?: number;
  }
): BuyCalculationResult {
  const qty = roundQuantity(Number(input.quantity));
  const unitPrice = roundUnitPrice(Number(input.unitPrice));
  const feeAmount = roundCurrencyAmount(Math.max(0, Number(input.feeAmount ?? 0)), state.currency);

  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ValidationError('Purchase quantity must be greater than zero.');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new ValidationError('Unit price must be zero or greater.');
  }

  const grossAmount = roundCurrencyAmount(multiplyDecimal(qty, unitPrice), state.currency);
  const totalCashOutflow = roundCurrencyAmount(addDecimal(grossAmount, feeAmount), state.currency);
  const purchaseCostBasis = totalCashOutflow;

  const newQuantity = roundQuantity(addDecimal(Math.max(0, state.quantity), qty));
  const newRemainingCostBasis = roundCurrencyAmount(
    addDecimal(Math.max(0, state.remainingCostBasis), purchaseCostBasis),
    state.currency
  );
  const newAverageCostPerUnit =
    newQuantity > 0 ? roundUnitPrice(divideDecimal(newRemainingCostBasis, newQuantity, 6)) : 0;

  return {
    grossAmount,
    feeAmount,
    totalCashOutflow,
    purchaseCostBasis,
    newQuantity,
    newRemainingCostBasis,
    newAverageCostPerUnit,
  };
}

/**
 * Pure Weighted Average Cost sale calculation.
 * Rejects sales exceeding available holding quantity and avoids floating-point negative cost basis drift.
 */
export function computeSellPositionUpdate(
  state: PositionCostState,
  input: {
    quantity: number;
    unitPrice: number;
    feeAmount?: number;
  }
): SellCalculationResult {
  const existingQty = roundQuantity(Math.max(0, state.quantity));
  const existingBasis = roundCurrencyAmount(Math.max(0, state.remainingCostBasis), state.currency);
  const soldQty = roundQuantity(Number(input.quantity));
  const unitPrice = roundUnitPrice(Number(input.unitPrice));
  const feeAmount = roundCurrencyAmount(Math.max(0, Number(input.feeAmount ?? 0)), state.currency);

  if (!Number.isFinite(soldQty) || soldQty <= 0) {
    throw new ValidationError('Sale quantity must be greater than zero.');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new ValidationError('Sale unit price must be zero or greater.');
  }
  if (soldQty > existingQty) {
    throw new ValidationError(
      `Cannot sell ${soldQty} unit(s); only ${existingQty} unit(s) available in this holding.`
    );
  }

  const currencyDecimals = getCurrencyDecimals(state.currency);
  const grossProceeds = roundCurrencyAmount(multiplyDecimal(soldQty, unitPrice), state.currency);
  const netProceeds = roundCurrencyAmount(
    subtractDecimal(grossProceeds, feeAmount),
    state.currency
  );

  const averageCostBeforeSale =
    existingQty > 0 ? roundUnitPrice(divideDecimal(existingBasis, existingQty, 6)) : 0;

  const newQuantity = roundQuantity(Math.max(0, subtractDecimal(existingQty, soldQty)));
  const allocatedCostBasis =
    newQuantity === 0
      ? existingBasis
      : allocateProportionalBasis(existingBasis, soldQty, existingQty, currencyDecimals);

  const newRemainingCostBasis =
    newQuantity === 0
      ? 0
      : roundCurrencyAmount(
          Math.max(0, subtractDecimal(existingBasis, allocatedCostBasis)),
          state.currency
        );

  const newAverageCostPerUnit =
    newQuantity > 0 ? roundUnitPrice(divideDecimal(newRemainingCostBasis, newQuantity, 6)) : 0;

  const realizedPnl = roundCurrencyAmount(
    subtractDecimal(netProceeds, allocatedCostBasis),
    state.currency
  );

  return {
    grossProceeds,
    feeAmount,
    netProceeds,
    averageCostBeforeSale,
    allocatedCostBasis,
    realizedPnl,
    newQuantity,
    newRemainingCostBasis,
    newAverageCostPerUnit,
  };
}

/**
 * Computes Unrealized P/L and percentage while safely handling zero remaining cost basis.
 */
export function computeUnrealizedPnl(
  marketValue: number,
  remainingCostBasis: number,
  currency: string
): UnrealizedPnlResult {
  const safeMarketValue = roundCurrencyAmount(Math.max(0, marketValue), currency);
  const safeCostBasis = roundCurrencyAmount(Math.max(0, remainingCostBasis), currency);
  const unrealizedPnl = roundCurrencyAmount(
    subtractDecimal(safeMarketValue, safeCostBasis),
    currency
  );

  const unrealizedPnlPct =
    safeCostBasis > 0
      ? roundUnitPrice((unrealizedPnl / safeCostBasis) * 100)
      : null;

  return {
    marketValue: safeMarketValue,
    remainingCostBasis: safeCostBasis,
    unrealizedPnl,
    unrealizedPnlPct,
  };
}

export interface ReplayedActivityPatch {
  id: string;
  grossAmount: number;
  netAmount: number;
  allocatedCostBasis?: number;
  realizedPnl?: number;
}

export interface HoldingReplayResult {
  state: PositionCostState;
  activityPatches: ReplayedActivityPatch[];
}

/**
 * Replays all chronological activities for a single holding under Weighted Average Cost.
 * Used on historical activity edits/deletions to guarantee zero silent corruption and atomic rollback
 * if an out-of-order edit/delete would oversell the holding.
 */
export function replayHoldingActivities(
  activities: InvestmentActivity[],
  currency: string
): HoldingReplayResult {
  const sorted = [...activities].sort(
    (a, b) =>
      a.activityDate.localeCompare(b.activityDate) || a.createdAt.localeCompare(b.createdAt)
  );

  const state: PositionCostState = {
    quantity: 0,
    remainingCostBasis: 0,
    averageCostPerUnit: 0,
    realizedPnlTotal: 0,
    currency: currency.toUpperCase(),
    currentPrice: undefined,
    currentMarketValue: 0,
    lastValuationDate: undefined,
  };

  const activityPatches: ReplayedActivityPatch[] = [];

  for (const act of sorted) {
    if (act.activityType === 'buy') {
      const qty = Number(act.quantity ?? 0);
      const unitPrice = Number(act.unitPrice ?? 0);
      const res = computeBuyPositionUpdate(state, {
        quantity: qty,
        unitPrice,
        feeAmount: act.feeAmount,
      });

      state.quantity = res.newQuantity;
      state.remainingCostBasis = res.newRemainingCostBasis;
      state.averageCostPerUnit = res.newAverageCostPerUnit;

      // Initialize currentPrice if never valued yet so initial market value reflects unitPrice
      if (state.currentPrice === undefined && unitPrice > 0) {
        state.currentPrice = roundUnitPrice(unitPrice);
        state.lastValuationDate = act.activityDate;
      }

      activityPatches.push({
        id: act.id,
        grossAmount: res.grossAmount,
        netAmount: res.totalCashOutflow,
      });
      continue;
    }

    if (act.activityType === 'sell' || act.activityType === 'partial_sell') {
      const qty = Number(act.quantity ?? 0);
      const unitPrice = Number(act.unitPrice ?? 0);
      const res = computeSellPositionUpdate(state, {
        quantity: qty,
        unitPrice,
        feeAmount: act.feeAmount,
      });

      state.quantity = res.newQuantity;
      state.remainingCostBasis = res.newRemainingCostBasis;
      state.averageCostPerUnit = res.newAverageCostPerUnit;
      state.realizedPnlTotal = roundCurrencyAmount(
        addDecimal(state.realizedPnlTotal, res.realizedPnl),
        state.currency
      );

      if (state.currentPrice === undefined && unitPrice > 0) {
        state.currentPrice = roundUnitPrice(unitPrice);
      }

      activityPatches.push({
        id: act.id,
        grossAmount: res.grossProceeds,
        netAmount: res.netProceeds,
        allocatedCostBasis: res.allocatedCostBasis,
        realizedPnl: res.realizedPnl,
      });
      continue;
    }

    if (act.activityType === 'valuation_update' || act.activityType === 'valuation_adjustment') {
      if (typeof act.unitPrice === 'number' && act.unitPrice >= 0) {
        state.currentPrice = roundUnitPrice(act.unitPrice);
        state.lastValuationDate = act.activityDate;
      } else if (act.grossAmount >= 0 && state.quantity > 0) {
        state.currentPrice = roundUnitPrice(divideDecimal(act.grossAmount, state.quantity, 6));
        state.currentMarketValue = roundCurrencyAmount(act.grossAmount, state.currency);
        state.lastValuationDate = act.activityDate;
      }
    }
  }

  if (state.quantity === 0) {
    state.currentMarketValue = 0;
  } else if (typeof state.currentPrice === 'number') {
    state.currentMarketValue = roundCurrencyAmount(
      multiplyDecimal(state.quantity, state.currentPrice),
      state.currency
    );
  } else {
    state.currentMarketValue = state.remainingCostBasis;
  }

  return {
    state,
    activityPatches,
  };
}
