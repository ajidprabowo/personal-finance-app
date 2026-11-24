import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { nowIso } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import {
  buildPeriodKey,
  evaluateMonthlyBudgets,
  getBudgetPeriodKey,
  getMonthDateBounds,
  shiftPeriodMonth,
} from '@/services/budget-calculation.service';
import type { Budget, RecordOrigin } from '@/types/entities';

export interface RolloverResultItem {
  categoryId: string;
  categoryName: string;
  currency: string;
  sourcePeriodKey: string;
  targetPeriodKey: string;
  sourceBudgetId: string;
  targetBudgetId: string;
  rolledOverAmount: number;
  createdTargetBudget: boolean;
}

export interface ApplyMonthlyRolloverSummary {
  sourcePeriodKey: string;
  targetPeriodKey: string;
  eligibleCount: number;
  appliedCount: number;
  skippedNoSurplusCount: number;
  items: RolloverResultItem[];
}

/**
 * Carries forward unused positive budget amounts from (sourceYear, sourceMonth) to the next month
 * strictly for active budgets where rolloverEnabled === true.
 * - Overspending (remaining <= 0) never produces a positive rollover.
 * - Re-running rollover is idempotent and never duplicates rollover amounts.
 * - Preserves historical base limitAmount on source budgets and never alters base limits on target budgets.
 */
export async function applyMonthlyBudgetRollover(params: {
  sourceYear: number;
  sourceMonth: number;
  recordOrigin?: RecordOrigin;
}): Promise<ApplyMonthlyRolloverSummary> {
  const origin: RecordOrigin = params.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  const targetPeriod = shiftPeriodMonth(params.sourceYear, params.sourceMonth, 1);
  const targetBounds = getMonthDateBounds(targetPeriod.year, targetPeriod.month);

  return db.transaction(
    'rw',
    [db.budgets, db.transactions, db.categories, db.preferences],
    async () => {
      const [allBudgets, transactions, categories, prefsList] = await Promise.all([
        db.budgets.where('recordOrigin').equals(origin).toArray(),
        db.transactions.where('recordOrigin').equals(origin).toArray(),
        db.categories.where('recordOrigin').equals(origin).toArray(),
        db.preferences.toArray(),
      ]);

      const prefs = prefsList[0];
      const baseCurrency = prefs?.baseCurrency ?? APP_CONFIG.defaultCurrency;
      const manualFxRates = prefs?.manualFxRates ?? [];
      const alertPrefs = prefs?.budgetAlertPreferences;

      const evaluation = evaluateMonthlyBudgets({
        budgets: allBudgets,
        transactions,
        categories,
        manualFxRates,
        baseCurrency,
        year: params.sourceYear,
        month: params.sourceMonth,
        alertPreferences: alertPrefs,
      });

      const rolloverItems = evaluation.items.filter((item) => item.budget.rolloverEnabled === true);
      const targetBudgets = allBudgets.filter(
        (b) => getBudgetPeriodKey(b) === targetPeriod.periodKey
      );

      const resultItems: RolloverResultItem[] = [];
      let skippedNoSurplusCount = 0;
      const timestamp = nowIso();

      for (const item of rolloverItems) {
        const surplus =
          item.remainingAmount > 0
            ? roundCurrencyAmount(item.remainingAmount, item.currency)
            : 0;

        // Find existing target budget for the same (categoryId, currency)
        const existingTarget =
          targetBudgets.find(
            (b) =>
              b.categoryId === item.categoryId &&
              b.currency.toUpperCase() === item.currency &&
              b.isActive !== false
          ) ??
          targetBudgets.find(
            (b) =>
              b.categoryId === item.categoryId &&
              b.currency.toUpperCase() === item.currency
          );

        if (existingTarget) {
          // Idempotently set rolloverAmount (even if 0 when prior surplus vanished)
          await db.budgets.update(existingTarget.id, {
            rolloverAmount: surplus,
            rolloverSourceBudgetId: item.budget.id,
            categoryNameSnapshot: item.categoryName,
            updatedAt: timestamp,
          });

          if (surplus > 0) {
            resultItems.push({
              categoryId: item.categoryId,
              categoryName: item.categoryName,
              currency: item.currency,
              sourcePeriodKey: evaluation.summary.periodKey,
              targetPeriodKey: targetPeriod.periodKey,
              sourceBudgetId: item.budget.id,
              targetBudgetId: existingTarget.id,
              rolledOverAmount: surplus,
              createdTargetBudget: false,
            });
          } else {
            skippedNoSurplusCount += 1;
          }
          continue;
        }

        if (surplus <= 0) {
          skippedNoSurplusCount += 1;
          continue;
        }

        // Create next-month budget carrying forward base limit + positive rollover
        const newTarget: Budget = {
          id: crypto.randomUUID(),
          name: item.budget.name ?? `${item.categoryName} Budget`,
          categoryId: item.categoryId,
          categoryNameSnapshot: item.categoryName,
          subcategoryId: item.budget.subcategoryId,
          period: 'monthly',
          year: targetPeriod.year,
          month: targetPeriod.month,
          periodKey: targetPeriod.periodKey,
          startDate: targetBounds.startDate,
          endDate: targetBounds.endDate,
          limitAmount: item.baseLimit,
          currency: item.currency,
          rolloverEnabled: true,
          rolloverAmount: surplus,
          rolloverSourceBudgetId: item.budget.id,
          isActive: true,
          notes: item.budget.notes,
          isTestData: origin === 'test',
          recordOrigin: origin,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await db.budgets.add(newTarget);
        targetBudgets.push(newTarget);

        resultItems.push({
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          currency: item.currency,
          sourcePeriodKey: evaluation.summary.periodKey,
          targetPeriodKey: targetPeriod.periodKey,
          sourceBudgetId: item.budget.id,
          targetBudgetId: newTarget.id,
          rolledOverAmount: surplus,
          createdTargetBudget: true,
        });
      }

      // Cascade recalculation across any already-linked future rollover chain beyond targetPeriod
      await recalculateBudgetRolloverChainInternal(
        db,
        targetPeriod.year,
        targetPeriod.month,
        origin
      );

      return {
        sourcePeriodKey: evaluation.summary.periodKey,
        targetPeriodKey: targetPeriod.periodKey,
        eligibleCount: rolloverItems.length,
        appliedCount: resultItems.length,
        skippedNoSurplusCount,
        items: resultItems,
      };
    }
  );
}

/**
 * Recalculates rolloverAmounts in chronological order starting from (startYear, startMonth)
 * for any subsequent months that already have budgets referencing a rolloverSourceBudgetId.
 * Safely keeps base limitAmounts untouched and never fabricates brand-new future months automatically.
 */
export async function recalculateBudgetRolloverChain(params: {
  fromYear: number;
  fromMonth: number;
  recordOrigin?: RecordOrigin;
}): Promise<number> {
  if (!Number.isFinite(params.fromYear) || params.fromMonth < 1 || params.fromMonth > 12) {
    throw new ValidationError('Invalid starting year or month for rollover recalculation.');
  }
  const origin: RecordOrigin = params.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  return db.transaction(
    'rw',
    [db.budgets, db.transactions, db.categories, db.preferences],
    async () => recalculateBudgetRolloverChainInternal(db, params.fromYear, params.fromMonth, origin)
  );
}

async function recalculateBudgetRolloverChainInternal(
  db: Awaited<ReturnType<typeof ensureDatabaseOpen>>,
  fromYear: number,
  fromMonth: number,
  origin: RecordOrigin
): Promise<number> {
  const [allBudgets, transactions, categories, prefsList] = await Promise.all([
    db.budgets.where('recordOrigin').equals(origin).toArray(),
    db.transactions.where('recordOrigin').equals(origin).toArray(),
    db.categories.where('recordOrigin').equals(origin).toArray(),
    db.preferences.toArray(),
  ]);

  const prefs = prefsList[0];
  const baseCurrency = prefs?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const manualFxRates = prefs?.manualFxRates ?? [];
  const alertPrefs = prefs?.budgetAlertPreferences;

  const periodKeys = Array.from(
    new Set(allBudgets.map((b) => getBudgetPeriodKey(b)))
  ).sort();
  const startKey = buildPeriodKey(fromYear, fromMonth);
  const laterPeriodKeys = periodKeys.filter((k) => k > startKey);
  if (laterPeriodKeys.length === 0) return 0;

  let updatedCount = 0;
  const workingBudgets = [...allBudgets];
  const timestamp = nowIso();

  for (const targetKey of laterPeriodKeys) {
    const [tYearStr, tMonthStr] = targetKey.split('-');
    const tYear = Number(tYearStr);
    const tMonth = Number(tMonthStr);
    const prev = shiftPeriodMonth(tYear, tMonth, -1);

    const targetsWithRollover = workingBudgets.filter(
      (b) => getBudgetPeriodKey(b) === targetKey && Boolean(b.rolloverSourceBudgetId)
    );
    if (targetsWithRollover.length === 0) continue;

    const prevEval = evaluateMonthlyBudgets({
      budgets: workingBudgets,
      transactions,
      categories,
      manualFxRates,
      baseCurrency,
      year: prev.year,
      month: prev.month,
      alertPreferences: alertPrefs,
    });

    for (const targetBudget of targetsWithRollover) {
      const sourceItem =
        prevEval.items.find((i) => i.budget.id === targetBudget.rolloverSourceBudgetId) ??
        prevEval.inactiveItems.find((i) => i.budget.id === targetBudget.rolloverSourceBudgetId);

      const nextRollover =
        sourceItem && sourceItem.budget.rolloverEnabled && sourceItem.isActive
          ? sourceItem.remainingAmount > 0
            ? roundCurrencyAmount(sourceItem.remainingAmount, sourceItem.currency)
            : 0
          : 0;

      if ((targetBudget.rolloverAmount ?? 0) !== nextRollover) {
        await db.budgets.update(targetBudget.id, {
          rolloverAmount: nextRollover,
          updatedAt: timestamp,
        });
        const idx = workingBudgets.findIndex((b) => b.id === targetBudget.id);
        if (idx >= 0) {
          workingBudgets[idx] = {
            ...workingBudgets[idx],
            rolloverAmount: nextRollover,
            updatedAt: timestamp,
          };
        }
        updatedCount += 1;
      }
    }
  }

  return updatedCount;
}
