import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { nowIso } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import { monthlyBudgetPlansRepository } from '@/repositories';
import {
  buildPeriodKey,
  getBudgetPeriodKey,
} from '@/services/budget-calculation.service';
import {
  convertCurrencyWithManualRate,
  findManualFxRate,
} from '@/services/portfolio-valuation.service';
import type {
  Budget,
  ManualFxRateEntry,
  MonthlyBudgetPlan,
  RecordOrigin,
} from '@/types/entities';

export interface MonthlyAllocationStatus {
  hasPlan: boolean;
  plan: MonthlyBudgetPlan | null;
  periodKey: string;
  currency: string;
  plannedTotalBudget: number | null;
  allocatedBaseLimits: number;
  allocatedWithRollover: number;
  unallocatedAmount: number | null;
  allocationPct: number | null;
  isOverAllocated: boolean;
  overAllocatedBy: number;
  excludedCurrencies: string[];
}

export function computeMonthlyAllocationStatus(params: {
  plan: MonthlyBudgetPlan | null;
  budgets: Budget[];
  manualFxRates: ManualFxRateEntry[];
  year: number;
  month: number;
  baseCurrency: string;
}): MonthlyAllocationStatus {
  const periodKey = buildPeriodKey(params.year, params.month);
  const currency = (params.plan?.currency || params.baseCurrency || APP_CONFIG.defaultCurrency).toUpperCase();
  const activeBudgets = params.budgets.filter(
    (b) => getBudgetPeriodKey(b) === periodKey && b.isActive !== false
  );

  let allocatedBaseLimits = 0;
  let allocatedWithRollover = 0;
  const excludedSet = new Set<string>();

  for (const b of activeBudgets) {
    const bCur = (b.currency || currency).toUpperCase();
    const rate = bCur === currency ? null : findManualFxRate(params.manualFxRates, bCur, currency);
    if (bCur !== currency && !rate) {
      excludedSet.add(bCur);
      continue;
    }
    const baseConv =
      bCur === currency
        ? roundCurrencyAmount(b.limitAmount, currency)
        : convertCurrencyWithManualRate(b.limitAmount, bCur, currency, rate).convertedAmount;
    const rolloverConv =
      bCur === currency
        ? roundCurrencyAmount(b.rolloverAmount ?? 0, currency)
        : convertCurrencyWithManualRate(b.rolloverAmount ?? 0, bCur, currency, rate).convertedAmount;

    allocatedBaseLimits = roundCurrencyAmount(addDecimal(allocatedBaseLimits, baseConv), currency);
    allocatedWithRollover = roundCurrencyAmount(
      addDecimal(allocatedWithRollover, addDecimal(baseConv, rolloverConv)),
      currency
    );
  }

  if (!params.plan || !params.plan.isActive) {
    return {
      hasPlan: false,
      plan: null,
      periodKey,
      currency,
      plannedTotalBudget: null,
      allocatedBaseLimits,
      allocatedWithRollover,
      unallocatedAmount: null,
      allocationPct: null,
      isOverAllocated: false,
      overAllocatedBy: 0,
      excludedCurrencies: Array.from(excludedSet).sort(),
    };
  }

  const plannedTotalBudget = roundCurrencyAmount(params.plan.totalBudgetAmount, currency);
  const unallocatedAmount = roundCurrencyAmount(
    subtractDecimal(plannedTotalBudget, allocatedBaseLimits),
    currency
  );
  const isOverAllocated = allocatedBaseLimits > plannedTotalBudget;
  const overAllocatedBy = isOverAllocated
    ? roundCurrencyAmount(subtractDecimal(allocatedBaseLimits, plannedTotalBudget), currency)
    : 0;
  const allocationPct =
    plannedTotalBudget > 0
      ? roundUnitPrice((allocatedBaseLimits / plannedTotalBudget) * 100)
      : allocatedBaseLimits > 0
        ? null
        : 0;

  return {
    hasPlan: true,
    plan: params.plan,
    periodKey,
    currency,
    plannedTotalBudget,
    allocatedBaseLimits,
    allocatedWithRollover,
    unallocatedAmount,
    allocationPct,
    isOverAllocated,
    overAllocatedBy,
    excludedCurrencies: Array.from(excludedSet).sort(),
  };
}

export async function saveMonthlyBudgetPlan(input: {
  year: number;
  month: number;
  totalBudgetAmount: number;
  currency?: string;
  notes?: string;
  confirmOverAllocation?: boolean;
  recordOrigin?: RecordOrigin;
}): Promise<{
  saved: boolean;
  requiresConfirmation: boolean;
  allocationStatus: MonthlyAllocationStatus;
}> {
  const origin: RecordOrigin = input.recordOrigin ?? 'user';
  if (!Number.isFinite(input.year) || input.month < 1 || input.month > 12) {
    throw new ValidationError('Valid year and month (1-12) are required for the monthly plan.');
  }
  const amount = Number(input.totalBudgetAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ValidationError('Monthly total budget must be zero or a positive number.');
  }

  const db = await ensureDatabaseOpen();
  const periodKey = buildPeriodKey(input.year, input.month);

  return db.transaction('rw', [db.monthlyBudgetPlans, db.budgets, db.preferences], async () => {
    const [existingPlans, budgets, prefsList] = await Promise.all([
      db.monthlyBudgetPlans
        .where('[recordOrigin+periodKey]')
        .equals([origin, periodKey])
        .toArray(),
      db.budgets.where('recordOrigin').equals(origin).toArray(),
      db.preferences.toArray(),
    ]);

    const prefs = prefsList[0];
    const baseCurrency = prefs?.baseCurrency ?? APP_CONFIG.defaultCurrency;
    const currency = (input.currency || baseCurrency).toUpperCase();
    const roundedTotal = roundCurrencyAmount(amount, currency);
    const manualFxRates = prefs?.manualFxRates ?? [];
    const existing = existingPlans.find((p) => p.currency.toUpperCase() === currency) ?? existingPlans[0] ?? null;

    const timestamp = nowIso();
    const candidatePlan: MonthlyBudgetPlan = existing
      ? {
          ...existing,
          totalBudgetAmount: roundedTotal,
          currency,
          notes: input.notes?.trim() || undefined,
          isActive: true,
          updatedAt: timestamp,
        }
      : {
          id: crypto.randomUUID(),
          periodKey,
          year: input.year,
          month: input.month,
          totalBudgetAmount: roundedTotal,
          currency,
          notes: input.notes?.trim() || undefined,
          isActive: true,
          isTestData: origin === 'test',
          recordOrigin: origin,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

    const previewStatus = computeMonthlyAllocationStatus({
      plan: candidatePlan,
      budgets,
      manualFxRates,
      year: input.year,
      month: input.month,
      baseCurrency: currency,
    });

    // If saving this plan causes over-allocation and user hasn't explicitly confirmed, warn without persisting
    if (previewStatus.isOverAllocated && !input.confirmOverAllocation) {
      return {
        saved: false,
        requiresConfirmation: true,
        allocationStatus: previewStatus,
      };
    }

    if (existing) {
      await db.monthlyBudgetPlans.put(candidatePlan);
    } else {
      await db.monthlyBudgetPlans.add(candidatePlan);
    }

    return {
      saved: true,
      requiresConfirmation: false,
      allocationStatus: previewStatus,
    };
  });
}

export async function removeMonthlyBudgetPlan(
  planId: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<void> {
  const existing = await monthlyBudgetPlansRepository.getById(planId);
  if (!existing) return;
  if (options?.recordOrigin && existing.recordOrigin !== options.recordOrigin) {
    throw new ValidationError('Cannot delete a budget plan from a different record origin.');
  }
  await monthlyBudgetPlansRepository.delete(planId);
}
