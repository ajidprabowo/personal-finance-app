import { liveQuery } from 'dexie';
import { ensureDatabaseOpen, getDatabase } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { getTodayInTimezone, nowIso } from '@/lib/dates';
import { SafetyGuardError, ValidationError } from '@/lib/errors';
import { addDecimal, roundUnitPrice, subtractDecimal } from '@/lib/precision';
import {
  budgetsRepository,
  categoriesRepository,
  monthlyBudgetPlansRepository,
  preferencesRepository,
  transactionsRepository,
} from '@/repositories';
import { syncBudgetAlertsForPeriod } from '@/services/budget-alert.service';
import {
  computeMonthlyAllocationStatus,
  type MonthlyAllocationStatus,
} from '@/services/budget-allocation.service';
import {
  buildPeriodKey,
  DEFAULT_BUDGET_ALERT_PREFERENCES,
  evaluateMonthlyBudgets,
  formatPeriodLabel,
  getBudgetPeriodKey,
  getMonthDateBounds,
  shiftPeriodMonth,
  type BudgetHealthStatus,
  type ComputedBudgetItem,
  type MonthlyBudgetSummaryMetrics,
  type UnbudgetedExpenseCategoryItem,
} from '@/services/budget-calculation.service';
import { recalculateBudgetRolloverChain } from '@/services/budget-rollover.service';
import type {
  Budget,
  BudgetAlert,
  BudgetAlertPreferences,
  Category,
  DateFormatPreference,
  ManualFxRateEntry,
  NumberFormatPreference,
  RecordOrigin,
} from '@/types/entities';

export type BudgetSortOption =
  | 'utilization_desc'
  | 'overspent_desc'
  | 'actual_desc'
  | 'budget_desc'
  | 'name_asc';

export type BudgetStatusFilter = 'all' | BudgetHealthStatus | 'inactive';

export interface CreateCategoryBudgetInput {
  categoryId: string;
  year: number;
  month: number;
  limitAmount: number;
  currency?: string;
  name?: string;
  rolloverEnabled?: boolean;
  notes?: string;
  confirmOverAllocation?: boolean;
  recordOrigin?: RecordOrigin;
}

export interface UpdateCategoryBudgetInput {
  limitAmount?: number;
  currency?: string;
  name?: string;
  rolloverEnabled?: boolean;
  isActive?: boolean;
  notes?: string;
  confirmOverAllocation?: boolean;
  recordOrigin?: RecordOrigin;
}

export interface BudgetMonthHistoryItem {
  periodKey: string;
  year: number;
  month: number;
  label: string;
  totalBudget: number;
  totalBaseLimit: number;
  totalRollover: number;
  totalActualBudgetedExpenses: number;
  totalAllMonthExpenses: number;
  remainingBudget: number;
  utilizationPct: number | null;
  activeBudgetCount: number;
  overBudgetCount: number;
}

export interface CategoryBudgetHistoryRow {
  categoryId: string;
  categoryName: string;
  months: Array<{
    periodKey: string;
    label: string;
    currency: string;
    availableBudget: number;
    actualAmount: number;
    remainingAmount: number;
    utilizationPct: number | null;
    status: BudgetHealthStatus;
  }>;
}

export interface MonthToMonthBudgetComparison {
  currentPeriodKey: string;
  previousPeriodKey: string;
  currentTotalBudget: number;
  previousTotalBudget: number | null;
  budgetChangeAbs: number | null;
  currentActual: number;
  previousActual: number | null;
  actualChangeAbs: number | null;
  actualChangePct: number | null;
  categoryVariances: Array<{
    categoryId: string;
    categoryName: string;
    currency: string;
    currentBudget: number | null;
    previousBudget: number | null;
    currentActual: number;
    previousActual: number;
    actualDelta: number;
    actualDeltaPct: number | null;
  }>;
}

export interface BudgetModuleSnapshot {
  generatedAt: string;
  periodKey: string;
  periodLabel: string;
  year: number;
  month: number;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
  summary: MonthlyBudgetSummaryMetrics;
  items: ComputedBudgetItem[];
  allActiveItems: ComputedBudgetItem[];
  inactiveItems: ComputedBudgetItem[];
  unbudgetedCategories: UnbudgetedExpenseCategoryItem[];
  allocationStatus: MonthlyAllocationStatus;
  alerts: BudgetAlert[];
  alertPreferences: BudgetAlertPreferences;
  history: BudgetMonthHistoryItem[];
  categoryHistory: CategoryBudgetHistoryRow[];
  monthComparison: MonthToMonthBudgetComparison;
  expenseCategories: Category[];
  manualFxRates: ManualFxRateEntry[];
}

function validateYearMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError('Budget year must be between 2000 and 2100.');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ValidationError('Budget month must be between 1 and 12.');
  }
}

export async function createCategoryBudget(
  input: CreateCategoryBudgetInput
): Promise<Budget> {
  const origin: RecordOrigin = input.recordOrigin ?? 'user';
  validateYearMonth(input.year, input.month);

  const rawLimit = Number(input.limitAmount);
  if (!Number.isFinite(rawLimit) || rawLimit < 0) {
    throw new ValidationError('Budget limit must be zero or a positive number.');
  }

  const db = await ensureDatabaseOpen();
  const periodKey = buildPeriodKey(input.year, input.month);
  const bounds = getMonthDateBounds(input.year, input.month);

  const created = await db.transaction(
    'rw',
    [db.budgets, db.categories, db.monthlyBudgetPlans, db.preferences],
    async () => {
      const [category, existingForPeriod, plans, prefsList] = await Promise.all([
        db.categories.get(input.categoryId),
        db.budgets.where('[recordOrigin+periodKey]').equals([origin, periodKey]).toArray(),
        db.monthlyBudgetPlans
          .where('[recordOrigin+periodKey]')
          .equals([origin, periodKey])
          .toArray(),
        db.preferences.toArray(),
      ]);

      if (!category || category.recordOrigin !== origin) {
        throw new ValidationError('Selected expense category does not exist.');
      }
      if (category.kind !== 'expense') {
        throw new ValidationError(
          `Budgets can only be created for expense categories. "${category.name}" is a ${category.kind} category.`
        );
      }
      if (category.isArchived) {
        throw new ValidationError(
          `Category "${category.name}" is archived. Unarchive it in Settings before creating a new budget.`
        );
      }

      const prefs = prefsList[0];
      const baseCurrency = prefs?.baseCurrency ?? APP_CONFIG.defaultCurrency;
      const currency = (input.currency || baseCurrency).toUpperCase();
      const limitAmount = roundCurrencyAmount(rawLimit, currency);

      // Prevent duplicate active budget for same (categoryId, periodKey, currency)
      const duplicate = existingForPeriod.find(
        (b) =>
          b.categoryId === category.id &&
          b.currency.toUpperCase() === currency &&
          b.isActive !== false
      );
      if (duplicate) {
        throw new ValidationError(
          `An active ${currency} budget for "${category.name}" already exists in ${formatPeriodLabel(
            periodKey
          )}. Edit the existing budget instead.`
        );
      }

      // Over-allocation check against optional Monthly Total Budget Plan
      const activePlan =
        plans.find((p) => p.isActive && p.currency.toUpperCase() === currency) ??
        plans.find((p) => p.isActive) ??
        null;

      const timestamp = nowIso();
      const budget: Budget = {
        id: crypto.randomUUID(),
        name: input.name?.trim() || `${category.name} Budget`,
        categoryId: category.id,
        categoryNameSnapshot: category.name,
        period: 'monthly',
        year: input.year,
        month: input.month,
        periodKey,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        limitAmount,
        currency,
        rolloverEnabled: Boolean(input.rolloverEnabled),
        rolloverAmount: 0,
        isActive: true,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      if (activePlan) {
        const allocationCheck = computeMonthlyAllocationStatus({
          plan: activePlan,
          budgets: [...existingForPeriod, budget],
          manualFxRates: prefs?.manualFxRates ?? [],
          year: input.year,
          month: input.month,
          baseCurrency: activePlan.currency,
        });
        if (allocationCheck.isOverAllocated && input.confirmOverAllocation !== true) {
          throw new SafetyGuardError(
            `Total allocated category budgets would exceed your ${formatPeriodLabel(
              periodKey
            )} Monthly Plan by ${allocationCheck.overAllocatedBy} ${
              allocationCheck.currency
            }. Explicit confirmation is required before saving.`
          );
        }
      }

      await db.budgets.add(budget);
      return budget;
    }
  );

  await syncBudgetAlertsForCurrentPeriod(input.year, input.month, origin);
  await recalculateBudgetRolloverChain({
    fromYear: input.year,
    fromMonth: input.month,
    recordOrigin: origin,
  });

  return created;
}

export async function createMultipleCategoryBudgets(params: {
  year: number;
  month: number;
  items: Array<{
    categoryId: string;
    limitAmount: number;
    currency?: string;
    rolloverEnabled?: boolean;
    notes?: string;
  }>;
  confirmOverAllocation?: boolean;
  recordOrigin?: RecordOrigin;
}): Promise<Budget[]> {
  if (!params.items || params.items.length === 0) {
    throw new ValidationError('Provide at least one category budget to create.');
  }
  const created: Budget[] = [];
  for (const item of params.items) {
    const record = await createCategoryBudget({
      categoryId: item.categoryId,
      year: params.year,
      month: params.month,
      limitAmount: item.limitAmount,
      currency: item.currency,
      rolloverEnabled: item.rolloverEnabled,
      notes: item.notes,
      confirmOverAllocation: params.confirmOverAllocation,
      recordOrigin: params.recordOrigin,
    });
    created.push(record);
  }
  return created;
}

export async function updateCategoryBudget(
  budgetId: string,
  patch: UpdateCategoryBudgetInput
): Promise<Budget> {
  const existing = await budgetsRepository.getById(budgetId);
  if (!existing) {
    throw new ValidationError('Budget record not found.');
  }
  const origin = patch.recordOrigin ?? existing.recordOrigin;
  if (existing.recordOrigin !== origin) {
    throw new SafetyGuardError('Cannot modify a budget from a different record origin.');
  }

  const periodKey = getBudgetPeriodKey(existing);
  const nextCurrency = (patch.currency || existing.currency).toUpperCase();
  const rawLimit =
    patch.limitAmount !== undefined ? Number(patch.limitAmount) : existing.limitAmount;
  if (!Number.isFinite(rawLimit) || rawLimit < 0) {
    throw new ValidationError('Budget limit must be zero or a positive number.');
  }
  const nextLimit = roundCurrencyAmount(rawLimit, nextCurrency);
  const nextIsActive = patch.isActive ?? (existing.isActive !== false);

  const db = await ensureDatabaseOpen();

  const updated = await db.transaction(
    'rw',
    [db.budgets, db.categories, db.monthlyBudgetPlans, db.preferences],
    async () => {
      const [existingForPeriod, plans, prefsList, category] = await Promise.all([
        db.budgets.where('[recordOrigin+periodKey]').equals([origin, periodKey]).toArray(),
        db.monthlyBudgetPlans
          .where('[recordOrigin+periodKey]')
          .equals([origin, periodKey])
          .toArray(),
        db.preferences.toArray(),
        db.categories.get(existing.categoryId),
      ]);

      if (nextIsActive) {
        const duplicate = existingForPeriod.find(
          (b) =>
            b.id !== existing.id &&
            b.categoryId === existing.categoryId &&
            b.currency.toUpperCase() === nextCurrency &&
            b.isActive !== false
        );
        if (duplicate) {
          throw new ValidationError(
            `Another active ${nextCurrency} budget already exists for this category in ${formatPeriodLabel(
              periodKey
            )}.`
          );
        }
      }

      const prefs = prefsList[0];
      const activePlan =
        plans.find((p) => p.isActive && p.currency.toUpperCase() === nextCurrency) ??
        plans.find((p) => p.isActive) ??
        null;

      const candidate: Budget = {
        ...existing,
        name:
          patch.name !== undefined
            ? patch.name.trim() || existing.name
            : existing.name,
        categoryNameSnapshot:
          category?.name ?? existing.categoryNameSnapshot ?? 'Uncategorized',
        limitAmount: nextLimit,
        currency: nextCurrency,
        rolloverEnabled:
          patch.rolloverEnabled !== undefined
            ? patch.rolloverEnabled
            : existing.rolloverEnabled,
        isActive: nextIsActive,
        notes: patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
        updatedAt: nowIso(),
      };

      if (activePlan && nextIsActive) {
        const simulated = existingForPeriod.map((b) => (b.id === existing.id ? candidate : b));
        const allocationCheck = computeMonthlyAllocationStatus({
          plan: activePlan,
          budgets: simulated,
          manualFxRates: prefs?.manualFxRates ?? [],
          year: existing.year,
          month: existing.month ?? 1,
          baseCurrency: activePlan.currency,
        });
        if (allocationCheck.isOverAllocated && patch.confirmOverAllocation !== true) {
          throw new SafetyGuardError(
            `Updating this budget exceeds your ${formatPeriodLabel(
              periodKey
            )} Monthly Plan by ${allocationCheck.overAllocatedBy} ${
              allocationCheck.currency
            }. Explicit confirmation is required.`
          );
        }
      }

      await db.budgets.put(candidate);
      return candidate;
    }
  );

  const monthNum = existing.month ?? 1;
  await syncBudgetAlertsForCurrentPeriod(existing.year, monthNum, origin);
  await recalculateBudgetRolloverChain({
    fromYear: existing.year,
    fromMonth: monthNum,
    recordOrigin: origin,
  });

  return updated;
}

export async function setCategoryBudgetActive(
  budgetId: string,
  isActive: boolean,
  options?: { confirmOverAllocation?: boolean; recordOrigin?: RecordOrigin }
): Promise<Budget> {
  return updateCategoryBudget(budgetId, {
    isActive,
    confirmOverAllocation: options?.confirmOverAllocation ?? true,
    recordOrigin: options?.recordOrigin,
  });
}

export async function deleteCategoryBudget(
  budgetId: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<void> {
  const existing = await budgetsRepository.getById(budgetId);
  if (!existing) return;
  const origin = options?.recordOrigin ?? existing.recordOrigin;
  if (existing.recordOrigin !== origin) {
    throw new SafetyGuardError('Cannot delete a budget from a different record origin.');
  }

  const db = await ensureDatabaseOpen();
  const periodKey = getBudgetPeriodKey(existing);

  await db.transaction('rw', [db.budgets, db.budgetAlerts], async () => {
    await db.budgets.delete(budgetId);
    // Clear linked alerts for deleted budget
    const alerts = await db.budgetAlerts
      .where('[recordOrigin+periodKey]')
      .equals([origin, periodKey])
      .toArray();
    for (const alert of alerts) {
      if (alert.budgetId === budgetId) {
        await db.budgetAlerts.delete(alert.id);
      }
    }
  });

  const monthNum = existing.month ?? 1;
  await syncBudgetAlertsForCurrentPeriod(existing.year, monthNum, origin);
  await recalculateBudgetRolloverChain({
    fromYear: existing.year,
    fromMonth: monthNum,
    recordOrigin: origin,
  });
}

async function syncBudgetAlertsForCurrentPeriod(
  year: number,
  month: number,
  origin: RecordOrigin
): Promise<BudgetAlert[]> {
  const [budgets, transactions, categories, prefsList] = await Promise.all([
    origin === 'test' ? budgetsRepository.getTestRecords() : budgetsRepository.getUserRecords(),
    origin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    origin === 'test'
      ? categoriesRepository.getTestRecords()
      : categoriesRepository.getUserRecords(),
    preferencesRepository.getAll(),
  ]);

  const prefs = prefsList[0];
  const baseCurrency = prefs?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const alertPrefs = prefs?.budgetAlertPreferences ?? DEFAULT_BUDGET_ALERT_PREFERENCES;
  const evalResult = evaluateMonthlyBudgets({
    budgets,
    transactions,
    categories,
    manualFxRates: prefs?.manualFxRates ?? [],
    baseCurrency,
    year,
    month,
    alertPreferences: alertPrefs,
  });

  return syncBudgetAlertsForPeriod({
    periodKey: buildPeriodKey(year, month),
    computedItems: evalResult.items,
    alertPreferences: alertPrefs,
    recordOrigin: origin,
  });
}

export async function reconcileAffectedBudgetPeriods(
  dateStrings: string[],
  origin: RecordOrigin = 'user'
): Promise<void> {
  const uniquePeriods = Array.from(
    new Set(
      dateStrings
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => d.slice(0, 7))
    )
  ).sort();

  for (const periodKey of uniquePeriods) {
    const [yStr, mStr] = periodKey.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    if (!Number.isInteger(year) || !Number.isInteger(month)) continue;
    await recalculateBudgetRolloverChain({
      fromYear: year,
      fromMonth: month,
      recordOrigin: origin,
    });
    await syncBudgetAlertsForCurrentPeriod(year, month, origin);
  }
}

function sortBudgetItems(
  items: ComputedBudgetItem[],
  sortBy: BudgetSortOption
): ComputedBudgetItem[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (sortBy === 'utilization_desc') {
      const uA = a.utilizationPct ?? (a.actualAmount > 0 ? 999999 : 0);
      const uB = b.utilizationPct ?? (b.actualAmount > 0 ? 999999 : 0);
      return uB - uA || b.actualAmount - a.actualAmount;
    }
    if (sortBy === 'overspent_desc') {
      const overA = Math.max(0, -a.remainingAmount);
      const overB = Math.max(0, -b.remainingAmount);
      return overB - overA || (b.utilizationPct ?? 0) - (a.utilizationPct ?? 0);
    }
    if (sortBy === 'actual_desc') {
      return (
        (b.convertedActualAmount ?? b.actualAmount) -
        (a.convertedActualAmount ?? a.actualAmount)
      );
    }
    if (sortBy === 'budget_desc') {
      return (
        (b.convertedAvailableBudget ?? b.availableBudget) -
        (a.convertedAvailableBudget ?? a.availableBudget)
      );
    }
    return a.categoryName.localeCompare(b.categoryName);
  });
  return copy;
}

export async function getBudgetModuleSnapshot(options?: {
  year?: number;
  month?: number;
  sortBy?: BudgetSortOption;
  statusFilter?: BudgetStatusFilter;
  search?: string;
  recordOrigin?: RecordOrigin;
  baseCurrency?: string;
  todayOverride?: string;
}): Promise<BudgetModuleSnapshot> {
  const origin: RecordOrigin = options?.recordOrigin ?? 'user';

  const [prefsList, budgets, plans, transactions, categories] = await Promise.all([
    preferencesRepository.getAll(),
    origin === 'test' ? budgetsRepository.getTestRecords() : budgetsRepository.getUserRecords(),
    origin === 'test'
      ? monthlyBudgetPlansRepository.getTestRecords()
      : monthlyBudgetPlansRepository.getUserRecords(),
    origin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    origin === 'test'
      ? categoriesRepository.getTestRecords()
      : categoriesRepository.getUserRecords(),
  ]);

  const prefs = prefsList[0];
  const timezone = prefs?.timezone ?? APP_CONFIG.defaultTimezone;
  const baseCurrency = (
    options?.baseCurrency ||
    prefs?.baseCurrency ||
    APP_CONFIG.defaultCurrency
  ).toUpperCase();
  const numberFormat: NumberFormatPreference =
    prefs?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat: DateFormatPreference =
    prefs?.dateFormat ?? APP_CONFIG.defaultDateFormat;
  const manualFxRates = prefs?.manualFxRates ?? [];
  const alertPreferences = prefs?.budgetAlertPreferences ?? DEFAULT_BUDGET_ALERT_PREFERENCES;

  const today = options?.todayOverride ?? getTodayInTimezone(timezone);
  const [todayY, todayM] = today.split('-').map(Number);
  const year = options?.year ?? todayY;
  const month = options?.month ?? todayM;
  validateYearMonth(year, month);
  const periodKey = buildPeriodKey(year, month);

  const currentEval = evaluateMonthlyBudgets({
    budgets,
    transactions,
    categories,
    manualFxRates,
    baseCurrency,
    year,
    month,
    alertPreferences,
  });

  // Sync deduplicated local alerts for this month
  const alerts = await syncBudgetAlertsForPeriod({
    periodKey,
    computedItems: currentEval.items,
    alertPreferences,
    recordOrigin: origin,
  });

  // Allocation plan status for selected month
  const activePlan =
    plans.find(
      (p) =>
        p.periodKey === periodKey &&
        p.isActive &&
        p.currency.toUpperCase() === baseCurrency
    ) ??
    plans.find((p) => p.periodKey === periodKey && p.isActive) ??
    null;

  const allocationStatus = computeMonthlyAllocationStatus({
    plan: activePlan,
    budgets,
    manualFxRates,
    year,
    month,
    baseCurrency,
  });

  // Sort & Filter items
  const sortBy = options?.sortBy ?? 'utilization_desc';
  const statusFilter = options?.statusFilter ?? 'all';
  const searchQuery = options?.search?.trim().toLowerCase() ?? '';

  const allActiveItems = sortBudgetItems(currentEval.items, sortBy);
  const baseList =
    statusFilter === 'inactive'
      ? sortBudgetItems(currentEval.inactiveItems, sortBy)
      : allActiveItems.filter((item) =>
          statusFilter === 'all' ? true : item.status === statusFilter
        );

  const filteredItems = searchQuery
    ? baseList.filter(
        (item) =>
          item.categoryName.toLowerCase().includes(searchQuery) ||
          (item.budget.name ?? '').toLowerCase().includes(searchQuery)
      )
    : baseList;

  // Multi-month history across all months that have budgets or expenses + selected month
  const monthKeySet = new Set<string>([periodKey]);
  for (const b of budgets) monthKeySet.add(getBudgetPeriodKey(b));
  for (const tx of transactions) {
    if (tx.type === 'expense' && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)) {
      monthKeySet.add(tx.date.slice(0, 7));
    }
  }
  const sortedMonthKeys = Array.from(monthKeySet).sort().slice(-12);

  const history: BudgetMonthHistoryItem[] = [];
  const categoryHistoryMap = new Map<
    string,
    {
      categoryId: string;
      categoryName: string;
      months: CategoryBudgetHistoryRow['months'];
    }
  >();

  let prevEvalResult: ReturnType<typeof evaluateMonthlyBudgets> | null = null;
  const prevShift = shiftPeriodMonth(year, month, -1);

  for (const mKey of sortedMonthKeys) {
    const [mYearStr, mMonthStr] = mKey.split('-');
    const mYear = Number(mYearStr);
    const mMonth = Number(mMonthStr);
    const evalMonth =
      mKey === periodKey
        ? currentEval
        : evaluateMonthlyBudgets({
            budgets,
            transactions,
            categories,
            manualFxRates,
            baseCurrency,
            year: mYear,
            month: mMonth,
            alertPreferences,
          });

    if (mKey === prevShift.periodKey) {
      prevEvalResult = evalMonth;
    }

    history.push({
      periodKey: mKey,
      year: mYear,
      month: mMonth,
      label: formatPeriodLabel(mKey),
      totalBudget: evalMonth.summary.totalBudget,
      totalBaseLimit: evalMonth.summary.totalBaseLimit,
      totalRollover: evalMonth.summary.totalRollover,
      totalActualBudgetedExpenses: evalMonth.summary.totalActualBudgetedExpenses,
      totalAllMonthExpenses: evalMonth.summary.totalAllMonthExpenses,
      remainingBudget: evalMonth.summary.remainingBudget,
      utilizationPct: evalMonth.summary.utilizationPct,
      activeBudgetCount: evalMonth.summary.activeBudgetCount,
      overBudgetCount: evalMonth.summary.overBudgetCount,
    });

    for (const item of evalMonth.items) {
      const existing = categoryHistoryMap.get(item.categoryId) ?? {
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        months: [],
      };
      // Prefer latest non-deleted name if available, otherwise keep historical snapshot
      existing.categoryName = item.categoryName;
      existing.months.push({
        periodKey: mKey,
        label: formatPeriodLabel(mKey),
        currency: item.currency,
        availableBudget: item.availableBudget,
        actualAmount: item.actualAmount,
        remainingAmount: item.remainingAmount,
        utilizationPct: item.utilizationPct,
        status: item.status,
      });
      categoryHistoryMap.set(item.categoryId, existing);
    }
  }

  if (!prevEvalResult) {
    prevEvalResult = evaluateMonthlyBudgets({
      budgets,
      transactions,
      categories,
      manualFxRates,
      baseCurrency,
      year: prevShift.year,
      month: prevShift.month,
      alertPreferences,
    });
  }

  const prevHasBudgets = prevEvalResult.items.length > 0;
  const prevHasActual = prevEvalResult.summary.totalActualBudgetedExpenses > 0;
  const hasPrevData = prevHasBudgets || prevHasActual;

  const currentActual = currentEval.summary.totalActualBudgetedExpenses;
  const prevActual = hasPrevData ? prevEvalResult.summary.totalActualBudgetedExpenses : null;
  const actualChangeAbs =
    prevActual !== null
      ? roundCurrencyAmount(subtractDecimal(currentActual, prevActual), baseCurrency)
      : null;
  const actualChangePct =
    prevActual !== null && prevActual > 0 && actualChangeAbs !== null
      ? roundUnitPrice((actualChangeAbs / prevActual) * 100)
      : null;

  const prevBudget = hasPrevData ? prevEvalResult.summary.totalBudget : null;
  const budgetChangeAbs =
    prevBudget !== null
      ? roundCurrencyAmount(
          subtractDecimal(currentEval.summary.totalBudget, prevBudget),
          baseCurrency
        )
      : null;

  // Per-category month-to-month variance
  const varianceCategoryIds = new Set<string>([
    ...currentEval.items.map((i) => i.categoryId),
    ...prevEvalResult.items.map((i) => i.categoryId),
  ]);
  const categoryVariances = Array.from(varianceCategoryIds)
    .map((catId) => {
      const curItem = currentEval.items.find((i) => i.categoryId === catId);
      const prevItem = prevEvalResult!.items.find((i) => i.categoryId === catId);
      const curActual = curItem?.actualAmount ?? 0;
      const pActual = prevItem?.actualAmount ?? 0;
      const delta = roundCurrencyAmount(
        subtractDecimal(curActual, pActual),
        curItem?.currency ?? prevItem?.currency ?? baseCurrency
      );
      const deltaPct = pActual > 0 ? roundUnitPrice((delta / pActual) * 100) : null;
      return {
        categoryId: catId,
        categoryName: curItem?.categoryName ?? prevItem?.categoryName ?? 'Category',
        currency: curItem?.currency ?? prevItem?.currency ?? baseCurrency,
        currentBudget: curItem ? curItem.availableBudget : null,
        previousBudget: prevItem ? prevItem.availableBudget : null,
        currentActual: curActual,
        previousActual: pActual,
        actualDelta: delta,
        actualDeltaPct: deltaPct,
      };
    })
    .sort((a, b) => Math.abs(b.actualDelta) - Math.abs(a.actualDelta));

  const expenseCategories = categories
    .filter((c) => c.kind === 'expense' && !c.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return {
    generatedAt: nowIso(),
    periodKey,
    periodLabel: formatPeriodLabel(periodKey),
    year,
    month,
    baseCurrency,
    timezone,
    numberFormat,
    dateFormat,
    summary: currentEval.summary,
    items: filteredItems,
    allActiveItems,
    inactiveItems: currentEval.inactiveItems,
    unbudgetedCategories: currentEval.unbudgetedCategories,
    allocationStatus,
    alerts,
    alertPreferences,
    history: [...history].reverse(),
    categoryHistory: Array.from(categoryHistoryMap.values()).sort((a, b) =>
      a.categoryName.localeCompare(b.categoryName)
    ),
    monthComparison: {
      currentPeriodKey: periodKey,
      previousPeriodKey: prevShift.periodKey,
      currentTotalBudget: currentEval.summary.totalBudget,
      previousTotalBudget: prevBudget,
      budgetChangeAbs,
      currentActual,
      previousActual: prevActual,
      actualChangeAbs,
      actualChangePct,
      categoryVariances,
    },
    expenseCategories,
    manualFxRates,
  };
}

/**
 * Reactive Dexie liveQuery subscription encapsulated inside the service layer
 * so Budget UI components never touch Dexie or IndexedDB directly.
 */
export function subscribeToBudgetChanges(onChange: () => void): () => void {
  if (typeof globalThis.indexedDB === 'undefined') {
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialized = false;
  let subscription: { unsubscribe: () => void } | null = null;
  let cancelled = false;

  ensureDatabaseOpen()
    .then(() => {
      if (cancelled) return;
      const db = getDatabase();
      const observable = liveQuery(async () => {
        const counts = await Promise.all([
          db.budgets.count(),
          db.monthlyBudgetPlans.count(),
          db.budgetAlerts.count(),
          db.transactions.count(),
          db.categories.count(),
          db.preferences.count(),
        ]);
        const [latestBudget, latestPlan, latestAlert, latestTx, latestPref] =
          await Promise.all([
            db.budgets.orderBy('updatedAt').last(),
            db.monthlyBudgetPlans.orderBy('updatedAt').last(),
            db.budgetAlerts.orderBy('updatedAt').last(),
            db.transactions.orderBy('updatedAt').last(),
            db.preferences.toCollection().first(),
          ]);
        return [
          ...counts,
          latestBudget?.updatedAt ?? '',
          latestPlan?.updatedAt ?? '',
          latestAlert?.updatedAt ?? '',
          latestTx?.updatedAt ?? '',
          latestPref?.updatedAt ?? '',
        ].join('|');
      });

      subscription = observable.subscribe({
        next: () => {
          if (!initialized) {
            initialized = true;
            return;
          }
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            onChange();
          }, 60);
        },
        error: () => {
          // Safe silent fallback
        },
      });
    })
    .catch(() => {
      // Handled by main loader
    });

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (subscription) subscription.unsubscribe();
  };
}
