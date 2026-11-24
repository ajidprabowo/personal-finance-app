'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { formatCurrency } from '@/lib/currency';
import { normalizeErrorMessage } from '@/lib/errors';

const BUDGET_CURRENCY_CODES = ['IDR', 'USD', 'SGD', 'EUR', 'GBP', 'JPY', 'AUD'] as const;
import {
  removeMonthlyBudgetPlan,
  saveMonthlyBudgetPlan,
  type MonthlyAllocationStatus,
} from '@/services/budget-allocation.service';
import { updateBudgetAlertPreferences } from '@/services/budget-alert.service';
import {
  createCategoryBudget,
  createMultipleCategoryBudgets,
  updateCategoryBudget,
} from '@/services/budget.service';
import type { ComputedBudgetItem } from '@/services/budget-calculation.service';
import type {
  BudgetAlertPreferences,
  Category,
  NumberFormatPreference,
} from '@/types/entities';

export function CategoryBudgetModal({
  open,
  onClose,
  year,
  month,
  periodLabel,
  baseCurrency,
  numberFormat,
  categories,
  editingItem,
  initialCategoryId,
  allocationStatus,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  month: number;
  periodLabel: string;
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
  categories: Category[];
  editingItem: ComputedBudgetItem | null;
  initialCategoryId?: string | null;
  allocationStatus: MonthlyAllocationStatus;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string>(
    editingItem?.categoryId ?? initialCategoryId ?? categories[0]?.id ?? ''
  );
  const [limitAmount, setLimitAmount] = useState<string>(
    editingItem ? String(editingItem.baseLimit) : ''
  );
  const [currency, setCurrency] = useState<string>(
    editingItem?.currency ?? baseCurrency
  );
  const [name, setName] = useState<string>(editingItem?.budget.name ?? '');
  const [rolloverEnabled, setRolloverEnabled] = useState<boolean>(
    editingItem?.budget.rolloverEnabled ?? false
  );
  const [notes, setNotes] = useState<string>(editingItem?.budget.notes ?? '');
  const [confirmOverAllocation, setConfirmOverAllocation] = useState<boolean>(false);
  const [overAllocationWarning, setOverAllocationWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const numericLimit = Number(limitAmount || 0);
  const projectedOverAllocation = useMemo(() => {
    if (!allocationStatus.hasPlan || allocationStatus.plannedTotalBudget === null) return null;
    if (currency.toUpperCase() !== allocationStatus.currency) return null;
    const prevBase = editingItem ? editingItem.baseLimit : 0;
    const projectedAllocated =
      allocationStatus.allocatedBaseLimits - prevBase + (Number.isFinite(numericLimit) ? numericLimit : 0);
    if (projectedAllocated > allocationStatus.plannedTotalBudget) {
      return projectedAllocated - allocationStatus.plannedTotalBudget;
    }
    return null;
  }, [allocationStatus, currency, editingItem, numericLimit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = Number(limitAmount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Enter a valid non-negative budget limit.');
      return;
    }
    if (!editingItem && !categoryId) {
      setError('Select an expense category.');
      return;
    }

    if (projectedOverAllocation !== null && !confirmOverAllocation) {
      setOverAllocationWarning(
        `Saving this category budget exceeds your ${periodLabel} Monthly Plan by ${formatCurrency(
          projectedOverAllocation,
          allocationStatus.currency,
          numberFormat
        )}. Check the confirmation box below to save without modifying other budgets.`
      );
      return;
    }

    setSubmitting(true);
    try {
      if (editingItem) {
        await updateCategoryBudget(editingItem.budget.id, {
          limitAmount: parsed,
          currency,
          name: name.trim() || undefined,
          rolloverEnabled,
          notes: notes.trim() || undefined,
          confirmOverAllocation: true,
        });
      } else {
        await createCategoryBudget({
          categoryId,
          year,
          month,
          limitAmount: parsed,
          currency,
          name: name.trim() || undefined,
          rolloverEnabled,
          notes: notes.trim() || undefined,
          confirmOverAllocation: true,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      const msg = normalizeErrorMessage(err);
      if (msg.toLowerCase().includes('monthly plan')) {
        setOverAllocationWarning(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingItem ? `Edit Budget · ${editingItem.categoryName}` : `New Category Budget · ${periodLabel}`}
      description="Monthly budgets track real expense transactions in the selected category and month."
      maxWidthClassName="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!editingItem ? (
          <Select
            label="Expense Category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : (
          <div className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
            Category: <span className="font-semibold text-ink">{editingItem.categoryName}</span> ·
            Period: <span className="font-semibold text-ink">{periodLabel}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input
              label="Monthly Budget Limit"
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 1500000"
              value={limitAmount}
              onChange={(e) => setLimitAmount(e.target.value)}
              required
            />
          </div>
          <Select
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            options={BUDGET_CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
          />
        </div>

        <Input
          label="Custom Label (Optional)"
          type="text"
          placeholder="Defaults to Category Budget"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-muted/50 p-3">
          <input
            type="checkbox"
            checked={rolloverEnabled}
            onChange={(e) => setRolloverEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line text-brand-primary focus:ring-brand-accent"
          />
          <span className="text-xs leading-relaxed text-ink">
            <span className="font-medium">Enable Rollover (Optional)</span>
            <span className="mt-0.5 block text-ink-muted">
              Allow unused positive budget from this month to be carried forward into next month
              when applying rollover. Disabled by default.
            </span>
          </span>
        </label>

        <Input
          label="Notes (Optional)"
          type="text"
          placeholder="Optional spending guideline or reminder"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {projectedOverAllocation !== null || overAllocationWarning ? (
          <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-ink">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
              <div className="space-y-2">
                <p className="font-semibold text-status-warning">Monthly Plan Over-Allocation</p>
                <p className="leading-relaxed text-ink-muted">
                  {overAllocationWarning ||
                    `Total category allocations will exceed your ${periodLabel} Monthly Plan by ${formatCurrency(
                      projectedOverAllocation ?? 0,
                      allocationStatus.currency,
                      numberFormat
                    )}. Other category budgets will not be altered.`}
                </p>
                <label className="flex cursor-pointer items-center gap-2 font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={confirmOverAllocation}
                    onChange={(e) => setConfirmOverAllocation(e.target.checked)}
                    className="h-4 w-4 rounded border-line"
                  />
                  Confirm saving even though allocations exceed the Monthly Plan
                </label>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editingItem ? 'Save Changes' : 'Create Budget'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BatchBudgetModal({
  open,
  onClose,
  year,
  month,
  periodLabel,
  baseCurrency,
  numberFormat,
  categories,
  existingCategoryIds,
  allocationStatus,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  month: number;
  periodLabel: string;
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
  categories: Category[];
  existingCategoryIds: Set<string>;
  allocationStatus: MonthlyAllocationStatus;
  onSaved: () => void;
}) {
  const availableCategories = useMemo(
    () => categories.filter((c) => !existingCategoryIds.has(c.id)),
    [categories, existingCategoryIds]
  );

  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rollovers, setRollovers] = useState<Record<string, boolean>>({});
  const [confirmOverAllocation, setConfirmOverAllocation] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEntries = useMemo(() => {
    return availableCategories
      .map((c) => ({
        category: c,
        raw: amounts[c.id] ?? '',
        amount: Number(amounts[c.id] ?? ''),
        rolloverEnabled: Boolean(rollovers[c.id]),
      }))
      .filter((entry) => entry.raw.trim() !== '' && Number.isFinite(entry.amount) && entry.amount >= 0);
  }, [availableCategories, amounts, rollovers]);

  const batchTotal = selectedEntries.reduce((sum, e) => sum + e.amount, 0);
  const overBy =
    allocationStatus.hasPlan && allocationStatus.plannedTotalBudget !== null
      ? Math.max(
          0,
          allocationStatus.allocatedBaseLimits + batchTotal - allocationStatus.plannedTotalBudget
        )
      : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (selectedEntries.length === 0) {
      setError('Enter a budget limit for at least one category.');
      return;
    }
    if (overBy > 0 && !confirmOverAllocation) {
      setError('Confirm the over-allocation warning before saving.');
      return;
    }

    setSubmitting(true);
    try {
      await createMultipleCategoryBudgets({
        year,
        month,
        items: selectedEntries.map((entry) => ({
          categoryId: entry.category.id,
          limitAmount: entry.amount,
          currency: baseCurrency,
          rolloverEnabled: entry.rolloverEnabled,
        })),
        confirmOverAllocation: true,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Batch Setup · ${periodLabel}`}
      description={`Assign ${baseCurrency} monthly limits across multiple unbudgeted expense categories at once.`}
      maxWidthClassName="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {availableCategories.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface-muted p-4 text-xs text-ink-muted">
            All active expense categories already have a budget for {periodLabel}.
          </div>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {availableCategories.map((cat) => (
              <div
                key={cat.id}
                className="grid grid-cols-1 items-center gap-3 rounded-lg border border-line bg-surface-muted/40 p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-5">
                  <p className="text-sm font-medium text-ink">{cat.name}</p>
                  <p className="text-[11px] text-ink-muted">{baseCurrency} monthly limit</p>
                </div>
                <div className="sm:col-span-4">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Skip if blank"
                    value={amounts[cat.id] ?? ''}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [cat.id]: e.target.value }))
                    }
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(rollovers[cat.id])}
                      onChange={(e) =>
                        setRollovers((prev) => ({ ...prev, [cat.id]: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-line"
                    />
                    Rollover
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs">
          <span className="text-ink-muted">
            Selected categories: <strong className="text-ink">{selectedEntries.length}</strong>
          </span>
          <span className="font-mono font-semibold tabular-nums text-ink">
            Batch Total: {formatCurrency(batchTotal, baseCurrency, numberFormat)}
          </span>
        </div>

        {overBy > 0 ? (
          <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-ink">
            <p className="font-semibold text-status-warning">
              Exceeds {periodLabel} Monthly Plan by{' '}
              {formatCurrency(overBy, allocationStatus.currency, numberFormat)}
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 font-medium text-ink">
              <input
                type="checkbox"
                checked={confirmOverAllocation}
                onChange={(e) => setConfirmOverAllocation(e.target.checked)}
                className="h-4 w-4 rounded border-line"
              />
              Confirm saving over-allocated category budgets
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={availableCategories.length === 0 || selectedEntries.length === 0}
          >
            Create {selectedEntries.length} Budget{selectedEntries.length === 1 ? '' : 's'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function MonthlyPlanModal({
  open,
  onClose,
  year,
  month,
  periodLabel,
  baseCurrency,
  numberFormat,
  allocationStatus,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  month: number;
  periodLabel: string;
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
  allocationStatus: MonthlyAllocationStatus;
  onSaved: () => void;
}) {
  const [totalAmount, setTotalAmount] = useState<string>(
    allocationStatus.plannedTotalBudget !== null
      ? String(allocationStatus.plannedTotalBudget)
      : ''
  );
  const [notes, setNotes] = useState<string>(allocationStatus.plan?.notes ?? '');
  const [confirmOverAllocation, setConfirmOverAllocation] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const parsedTotal = Number(totalAmount || 0);
  const willOverAllocate =
    Number.isFinite(parsedTotal) &&
    totalAmount.trim() !== '' &&
    allocationStatus.allocatedBaseLimits > parsedTotal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const val = Number(totalAmount);
    if (!Number.isFinite(val) || val < 0) {
      setError('Enter a valid non-negative Monthly Total Budget.');
      return;
    }
    if (willOverAllocate && !confirmOverAllocation) {
      setError('Please confirm saving a Monthly Plan lower than your current category allocations.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await saveMonthlyBudgetPlan({
        year,
        month,
        totalBudgetAmount: val,
        currency: baseCurrency,
        notes,
        confirmOverAllocation: true,
      });
      if (res.saved) {
        onSaved();
        onClose();
      }
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemovePlan = async () => {
    if (!allocationStatus.plan) return;
    setSubmitting(true);
    try {
      await removeMonthlyBudgetPlan(allocationStatus.plan.id);
      onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Monthly Total Budget Plan · ${periodLabel}`}
      description="Optional monthly spending ceiling to track how much of your target budget is allocated to categories."
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-line bg-surface-muted p-3 text-xs text-ink-muted">
          Currently allocated across active category budgets:{' '}
          <span className="font-mono font-semibold text-ink">
            {formatCurrency(allocationStatus.allocatedBaseLimits, baseCurrency, numberFormat)}
          </span>
        </div>

        <Input
          label={`Planned Total Monthly Budget (${baseCurrency})`}
          type="number"
          min="0"
          step="any"
          placeholder="e.g. 8000000"
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value)}
          required
        />

        <Input
          label="Planning Notes (Optional)"
          type="text"
          placeholder="e.g. Target monthly household spending cap"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {willOverAllocate ? (
          <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-ink">
            <p className="font-semibold text-status-warning">Existing Category Allocations Exceed Plan</p>
            <p className="mt-1 leading-relaxed text-ink-muted">
              Current category budgets exceed this ceiling by{' '}
              {formatCurrency(
                allocationStatus.allocatedBaseLimits - parsedTotal,
                baseCurrency,
                numberFormat
              )}
              . Existing category budgets will remain unchanged.
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 font-medium text-ink">
              <input
                type="checkbox"
                checked={confirmOverAllocation}
                onChange={(e) => setConfirmOverAllocation(e.target.checked)}
                className="h-4 w-4 rounded border-line"
              />
              Save this ceiling without altering category budgets
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-2">
          <div>
            {allocationStatus.hasPlan ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleRemovePlan}
                disabled={submitting}
              >
                Remove Plan
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save Plan
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function BudgetAlertSettingsModal({
  open,
  onClose,
  alertPreferences,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  alertPreferences: BudgetAlertPreferences;
  onSaved: () => void;
}) {
  const [nearLimitPct, setNearLimitPct] = useState<string>(
    String(alertPreferences.nearLimitThresholdPct)
  );
  const [overBudgetPct, setOverBudgetPct] = useState<string>(
    String(alertPreferences.overBudgetThresholdPct)
  );
  const [enableNear, setEnableNear] = useState<boolean>(
    alertPreferences.enableNearLimitAlerts
  );
  const [enableFull, setEnableFull] = useState<boolean>(
    alertPreferences.enableFullLimitAlerts
  );
  const [enableOver, setEnableOver] = useState<boolean>(
    alertPreferences.enableOverBudgetAlerts
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await updateBudgetAlertPreferences({
        nearLimitThresholdPct: Number(nearLimitPct),
        overBudgetThresholdPct: Number(overBudgetPct),
        enableNearLimitAlerts: enableNear,
        enableFullLimitAlerts: enableFull,
        enableOverBudgetAlerts: enableOver,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Budget Alert Thresholds"
      description="Customize local threshold percentages and alert visibility. All evaluation stays on your device."
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Near-Limit Threshold (%)"
            type="number"
            min="10"
            max="99"
            value={nearLimitPct}
            onChange={(e) => setNearLimitPct(e.target.value)}
            helperText="Default: 80%"
          />
          <Input
            label="Over-Budget Threshold (%)"
            type="number"
            min="100"
            max="500"
            value={overBudgetPct}
            onChange={(e) => setOverBudgetPct(e.target.value)}
            helperText="Default: 100%"
          />
        </div>

        <div className="space-y-2 rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
          <label className="flex cursor-pointer items-center gap-2.5 text-ink">
            <input
              type="checkbox"
              checked={enableNear}
              onChange={(e) => setEnableNear(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            <span>Alert when reaching Near-Limit ({nearLimitPct || 80}% – 99.9%)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-ink">
            <input
              type="checkbox"
              checked={enableFull}
              onChange={(e) => setEnableFull(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            <span>Alert when Budget Reached (100%)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-ink">
            <input
              type="checkbox"
              checked={enableOver}
              onChange={(e) => setEnableOver(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            <span>Alert when Over Budget (&gt; {overBudgetPct || 100}%)</span>
          </label>
        </div>

        {error ? (
          <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            <Check className="h-4 w-4" />
            Save Alert Rules
          </Button>
        </div>
      </form>
    </Modal>
  );
}
