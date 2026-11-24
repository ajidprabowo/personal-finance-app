import { ensureDatabaseOpen } from '@/database/client';
import { nowIso } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import { budgetAlertsRepository, preferencesRepository } from '@/repositories';
import {
  DEFAULT_BUDGET_ALERT_PREFERENCES,
  type ComputedBudgetItem,
} from '@/services/budget-calculation.service';
import type {
  BudgetAlert,
  BudgetAlertPreferences,
  BudgetAlertThresholdType,
  RecordOrigin,
} from '@/types/entities';

export function buildBudgetAlertKey(
  periodKey: string,
  categoryId: string,
  currency: string,
  thresholdType: BudgetAlertThresholdType
): string {
  return `${periodKey}:${categoryId}:${currency.toUpperCase()}:${thresholdType}`;
}

function determineApplicableThreshold(
  item: ComputedBudgetItem,
  prefs: BudgetAlertPreferences
): { thresholdType: BudgetAlertThresholdType; thresholdPct: number } | null {
  if (!item.isActive) return null;

  // Zero-limit budget with spending is treated as over-budget
  if (item.availableBudget <= 0) {
    if (item.actualAmount > 0 && prefs.enableOverBudgetAlerts) {
      return {
        thresholdType: 'over_budget',
        thresholdPct: prefs.overBudgetThresholdPct,
      };
    }
    return null;
  }

  const pct = item.utilizationPct ?? 0;

  if (pct > prefs.overBudgetThresholdPct && prefs.enableOverBudgetAlerts) {
    return {
      thresholdType: 'over_budget',
      thresholdPct: prefs.overBudgetThresholdPct,
    };
  }

  if (
    pct >= 100 &&
    pct <= prefs.overBudgetThresholdPct &&
    prefs.enableFullLimitAlerts
  ) {
    return {
      thresholdType: 'reached_100',
      thresholdPct: 100,
    };
  }

  if (
    pct >= prefs.nearLimitThresholdPct &&
    pct < 100 &&
    prefs.enableNearLimitAlerts
  ) {
    return {
      thresholdType: 'near_limit_80',
      thresholdPct: prefs.nearLimitThresholdPct,
    };
  }

  return null;
}

/**
 * Synchronizes local budgetAlerts for a specific periodKey so alerts are:
 * - deduplicated per category, period, currency, and threshold
 * - automatically created/updated when spending crosses 80% / 100% / >100%
 * - automatically resolved if spending drops back below threshold or a budget is deleted/deactivated
 * - preserving user dismissal state for the currently active threshold
 */
export async function syncBudgetAlertsForPeriod(params: {
  periodKey: string;
  computedItems: ComputedBudgetItem[];
  alertPreferences?: BudgetAlertPreferences;
  recordOrigin?: RecordOrigin;
}): Promise<BudgetAlert[]> {
  const origin: RecordOrigin = params.recordOrigin ?? 'user';
  const prefs = params.alertPreferences ?? DEFAULT_BUDGET_ALERT_PREFERENCES;
  const db = await ensureDatabaseOpen();
  const timestamp = nowIso();

  return db.transaction('rw', [db.budgetAlerts], async () => {
    const existingAlerts = await db.budgetAlerts
      .where('[recordOrigin+periodKey]')
      .equals([origin, params.periodKey])
      .toArray();

    const byAlertKey = new Map(existingAlerts.map((a) => [a.alertKey, a]));
    const activeTargetKeys = new Set<string>();

    for (const item of params.computedItems) {
      const applicable = determineApplicableThreshold(item, prefs);
      if (!applicable) continue;

      const key = buildBudgetAlertKey(
        params.periodKey,
        item.categoryId,
        item.currency,
        applicable.thresholdType
      );
      activeTargetKeys.add(key);

      const utilizationPct = item.utilizationPct ?? (item.actualAmount > 0 ? 100 : 0);
      const existing = byAlertKey.get(key);

      if (existing) {
        // Keep dismissed status if user already dismissed this exact threshold alert,
        // unless spending had previously resolved and re-triggered it.
        const nextStatus = existing.status === 'dismissed' ? 'dismissed' : 'active';
        await db.budgetAlerts.update(existing.id, {
          budgetId: item.budget.id,
          categoryNameSnapshot: item.categoryName,
          thresholdPct: applicable.thresholdPct,
          utilizationPct,
          budgetAmount: item.availableBudget,
          actualAmount: item.actualAmount,
          status: nextStatus,
          lastEvaluatedAt: timestamp,
        });
      } else {
        const alert: BudgetAlert = {
          id: crypto.randomUUID(),
          alertKey: key,
          budgetId: item.budget.id,
          categoryId: item.categoryId,
          categoryNameSnapshot: item.categoryName,
          periodKey: params.periodKey,
          currency: item.currency,
          thresholdType: applicable.thresholdType,
          thresholdPct: applicable.thresholdPct,
          utilizationPct,
          budgetAmount: item.availableBudget,
          actualAmount: item.actualAmount,
          status: 'active',
          triggeredAt: timestamp,
          lastEvaluatedAt: timestamp,
          isTestData: origin === 'test',
          recordOrigin: origin,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await db.budgetAlerts.add(alert);
        byAlertKey.set(key, alert);
      }
    }

    // Resolve any prior alerts for this period whose threshold is no longer the current active one
    for (const existing of existingAlerts) {
      if (!activeTargetKeys.has(existing.alertKey) && existing.status !== 'resolved') {
        await db.budgetAlerts.update(existing.id, {
          status: 'resolved',
          lastEvaluatedAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    const refreshed = await db.budgetAlerts
      .where('[recordOrigin+periodKey]')
      .equals([origin, params.periodKey])
      .toArray();

    return refreshed.sort((a, b) => b.utilizationPct - a.utilizationPct);
  });
}

export async function dismissBudgetAlert(alertId: string): Promise<BudgetAlert> {
  const existing = await budgetAlertsRepository.getById(alertId);
  if (!existing) {
    throw new ValidationError('Budget alert not found.');
  }
  return budgetAlertsRepository.update(alertId, {
    status: 'dismissed',
    dismissedAt: nowIso(),
  });
}

export async function reactivateBudgetAlert(alertId: string): Promise<BudgetAlert> {
  const existing = await budgetAlertsRepository.getById(alertId);
  if (!existing) {
    throw new ValidationError('Budget alert not found.');
  }
  return budgetAlertsRepository.update(alertId, {
    status: 'active',
    dismissedAt: undefined,
  });
}

export async function updateBudgetAlertPreferences(
  patch: Partial<BudgetAlertPreferences>
): Promise<BudgetAlertPreferences> {
  const prefsList = await preferencesRepository.getAll();
  const prefs = prefsList[0];
  if (!prefs) {
    throw new ValidationError('User preferences record not found.');
  }

  const current = prefs.budgetAlertPreferences ?? DEFAULT_BUDGET_ALERT_PREFERENCES;
  const nearLimitThresholdPct = Number(
    patch.nearLimitThresholdPct ?? current.nearLimitThresholdPct
  );
  const overBudgetThresholdPct = Number(
    patch.overBudgetThresholdPct ?? current.overBudgetThresholdPct
  );

  if (
    !Number.isFinite(nearLimitThresholdPct) ||
    nearLimitThresholdPct < 10 ||
    nearLimitThresholdPct >= 100
  ) {
    throw new ValidationError('Near-limit alert threshold must be between 10% and 99%.');
  }
  if (
    !Number.isFinite(overBudgetThresholdPct) ||
    overBudgetThresholdPct < 100 ||
    overBudgetThresholdPct > 500
  ) {
    throw new ValidationError('Over-budget alert threshold must be between 100% and 500%.');
  }

  const nextPrefs: BudgetAlertPreferences = {
    nearLimitThresholdPct: Math.round(nearLimitThresholdPct),
    overBudgetThresholdPct: Math.round(overBudgetThresholdPct),
    enableNearLimitAlerts:
      patch.enableNearLimitAlerts ?? current.enableNearLimitAlerts,
    enableFullLimitAlerts:
      patch.enableFullLimitAlerts ?? current.enableFullLimitAlerts,
    enableOverBudgetAlerts:
      patch.enableOverBudgetAlerts ?? current.enableOverBudgetAlerts,
  };

  await preferencesRepository.update(prefs.id, {
    budgetAlertPreferences: nextPrefs,
  });

  return nextPrefs;
}
