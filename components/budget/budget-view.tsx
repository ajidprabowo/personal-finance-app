'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  History,
  Layers,
  PiggyBank,
  Plus,
  Power,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  BudgetHistoryTrendChart,
  BudgetVsActualComparisonChart,
} from '@/components/budget/budget-charts';
import {
  BatchBudgetModal,
  BudgetAlertSettingsModal,
  CategoryBudgetModal,
  MonthlyPlanModal,
} from '@/components/budget/budget-modals';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import { formatSensitiveNumber, formatSensitiveSignedNumber } from '@/lib/privacy-mode';
import { getTodayInTimezone } from '@/lib/dates';
import { normalizeErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  dismissBudgetAlert,
  reactivateBudgetAlert,
} from '@/services/budget-alert.service';
import {
  getMonthDateBounds,
  shiftPeriodMonth,
  type ComputedBudgetItem,
} from '@/services/budget-calculation.service';
import { applyMonthlyBudgetRollover } from '@/services/budget-rollover.service';
import {
  deleteCategoryBudget,
  getBudgetModuleSnapshot,
  setCategoryBudgetActive,
  subscribeToBudgetChanges,
  type BudgetModuleSnapshot,
  type BudgetSortOption,
  type BudgetStatusFilter,
} from '@/services/budget.service';

const SORT_OPTIONS: Array<{ value: BudgetSortOption; label: string }> = [
  { value: 'utilization_desc', label: 'Highest Utilization %' },
  { value: 'overspent_desc', label: 'Most Overspent' },
  { value: 'actual_desc', label: 'Highest Actual Spend' },
  { value: 'budget_desc', label: 'Highest Budget Limit' },
  { value: 'name_asc', label: 'Category Name (A-Z)' },
];

const STATUS_FILTER_OPTIONS: Array<{ value: BudgetStatusFilter; label: string }> = [
  { value: 'all', label: 'All Active' },
  { value: 'over_budget', label: 'Over Budget' },
  { value: 'near_limit', label: 'Near Limit' },
  { value: 'on_track', label: 'On Track' },
  { value: 'inactive', label: 'Deactivated' },
];

function statusBadgeMeta(item: ComputedBudgetItem): {
  label: string;
  badgeClass: string;
  barClass: string;
} {
  if (!item.isActive) {
    return {
      label: 'Inactive',
      badgeClass: 'border-line bg-surface-muted text-ink-muted',
      barClass: 'bg-ink-muted/40',
    };
  }
  if (item.status === 'over_budget') {
    return {
      label: 'Over Budget',
      badgeClass: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
      barClass: 'bg-status-danger',
    };
  }
  if (item.status === 'near_limit') {
    return {
      label: 'Near Limit',
      badgeClass: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
      barClass: 'bg-status-warning',
    };
  }
  return {
    label: 'On Track',
    badgeClass: 'border-status-success/30 bg-status-success/10 text-status-success',
    barClass: 'bg-status-success',
  };
}

export function BudgetView() {
  const { preferences } = useBootstrap();
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useNotifications();
  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;

  const initialPeriod = useMemo(() => {
    const today = getTodayInTimezone(timezone);
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m };
  }, [timezone]);

  const [selectedYear, setSelectedYear] = useState<number>(initialPeriod.year);
  const [selectedMonth, setSelectedMonth] = useState<number>(initialPeriod.month);
  const [sortBy, setSortBy] = useState<BudgetSortOption>('utilization_desc');
  const [statusFilter, setStatusFilter] = useState<BudgetStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [historyTab, setHistoryTab] = useState<'monthly' | 'comparison' | 'category'>('monthly');
  const [showDismissedAlerts, setShowDismissedAlerts] = useState<boolean>(false);

  const [snapshot, setSnapshot] = useState<BudgetModuleSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Modal & confirmation states
  const [budgetModalOpen, setBudgetModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<ComputedBudgetItem | null>(null);
  const [prefillCategoryId, setPrefillCategoryId] = useState<string | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [planModalOpen, setPlanModalOpen] = useState<boolean>(false);
  const [alertSettingsOpen, setAlertSettingsOpen] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<ComputedBudgetItem | null>(null);
  const [rolloverConfirmOpen, setRolloverConfirmOpen] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<boolean>(false);

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await getBudgetModuleSnapshot({
          year: selectedYear,
          month: selectedMonth,
          sortBy,
          statusFilter,
          search: searchQuery,
        });
        setSnapshot(data);
      } catch (err) {
        setError(normalizeErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedYear, selectedMonth, sortBy, statusFilter, searchQuery]
  );

  useEffect(() => {
    let cancelled = false;
    getBudgetModuleSnapshot({
      year: selectedYear,
      month: selectedMonth,
      sortBy,
      statusFilter,
      search: searchQuery,
    })
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
          setLoading(false);
          setRefreshing(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(normalizeErrorMessage(err));
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear, selectedMonth, sortBy, statusFilter, searchQuery]);

  useEffect(() => {
    return subscribeToBudgetChanges(() => {
      void loadSnapshot(true);
    });
  }, [loadSnapshot]);

  const navigateMonth = (delta: number) => {
    const next = shiftPeriodMonth(selectedYear, selectedMonth, delta);
    setSelectedYear(next.year);
    setSelectedMonth(next.month);
  };

  const resetToCurrentMonth = () => {
    const today = getTodayInTimezone(timezone);
    const [y, m] = today.split('-').map(Number);
    setSelectedYear(y);
    setSelectedMonth(m);
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      await dismissBudgetAlert(alertId);
      await loadSnapshot(true);
    } catch (err) {
      notifyError('Alert Update Failed', normalizeErrorMessage(err));
    }
  };

  const handleReactivateAlert = async (alertId: string) => {
    try {
      await reactivateBudgetAlert(alertId);
      await loadSnapshot(true);
    } catch (err) {
      notifyError('Alert Update Failed', normalizeErrorMessage(err));
    }
  };

  const handleToggleActive = async (item: ComputedBudgetItem) => {
    setActionBusy(true);
    try {
      await setCategoryBudgetActive(item.budget.id, !item.isActive, {
        confirmOverAllocation: true,
      });
      notifySuccess(
        item.isActive ? 'Budget Deactivated' : 'Budget Reactivated',
        `${item.categoryName} budget for ${snapshot?.periodLabel ?? ''} has been ${
          item.isActive ? 'deactivated' : 'reactivated'
        }.`
      );
      await loadSnapshot(true);
    } catch (err) {
      notifyError('Action Failed', normalizeErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(true);
    try {
      await deleteCategoryBudget(deleteTarget.budget.id);
      notifySuccess(
        'Budget Deleted',
        `Removed ${deleteTarget.categoryName} budget for ${snapshot?.periodLabel ?? ''}.`
      );
      setDeleteTarget(null);
      await loadSnapshot(true);
    } catch (err) {
      notifyError('Delete Failed', normalizeErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const handleApplyRollover = async () => {
    setActionBusy(true);
    try {
      const result = await applyMonthlyBudgetRollover({
        sourceYear: selectedYear,
        sourceMonth: selectedMonth,
      });
      setRolloverConfirmOpen(false);
      notifySuccess(
        'Monthly Rollover Applied',
        result.appliedCount > 0
          ? `Carried forward unused balances for ${result.appliedCount} budget(s) into ${result.targetPeriodKey}.`
          : `No positive unused rollover amounts to carry forward from ${result.sourcePeriodKey}.`
      );
      await loadSnapshot(true);
    } catch (err) {
      notifyError('Rollover Failed', normalizeErrorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const baseCurrency = snapshot?.baseCurrency ?? preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const numberFormat = snapshot?.numberFormat ?? preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const activeAlerts = (snapshot?.alerts ?? []).filter((a) => a.status === 'active');
  const dismissedAlerts = (snapshot?.alerts ?? []).filter((a) => a.status === 'dismissed');
  const monthBounds = getMonthDateBounds(selectedYear, selectedMonth);
  const nextMonthInfo = shiftPeriodMonth(selectedYear, selectedMonth, 1);

  const rolloverEligibleItems = (snapshot?.allActiveItems ?? []).filter(
    (i) => i.budget.rolloverEnabled
  );
  const existingActiveCategoryIds = useMemo(
    () => new Set((snapshot?.allActiveItems ?? []).map((i) => i.categoryId)),
    [snapshot?.allActiveItems]
  );

  return (
    <AppLayout>
      <PageContainer maxWidth="wide">
        <PageHeader
          title={t('page.budget.title')}
          description={t('page.budget.description')}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAlertSettingsOpen(true)}
                disabled={!snapshot}
              >
                <Bell className="h-3.5 w-3.5" />
                Alert Rules
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPlanModalOpen(true)}
                disabled={!snapshot}
              >
                <Target className="h-3.5 w-3.5" />
                Monthly Plan
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBatchModalOpen(true)}
                disabled={!snapshot}
              >
                <Layers className="h-3.5 w-3.5" />
                Batch Setup
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditingItem(null);
                  setPrefillCategoryId(null);
                  setBudgetModalOpen(true);
                }}
                disabled={!snapshot || snapshot.expenseCategories.length === 0}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Budget
              </Button>
            </div>
          }
        />
        <div className="space-y-6">
          {/* Month Selector & Quick Status Bar */}
          <Card className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateMonth(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-[140px] items-center justify-center gap-2 rounded-lg border border-line bg-surface-muted px-3 py-1.5 text-sm font-semibold text-ink">
                  <Calendar className="h-4 w-4 text-brand-accent" />
                  <span>{snapshot?.periodLabel ?? `${selectedYear}-${selectedMonth}`}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateMonth(1)}
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={resetToCurrentMonth}>
                  Today
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                {snapshot ? (
                  <>
                    <span className="rounded-md border border-line bg-surface-muted px-2.5 py-1">
                      Active:{' '}
                      <strong className="text-ink">{snapshot.summary.activeBudgetCount}</strong>
                    </span>
                    {snapshot.summary.overBudgetCount > 0 ? (
                      <span className="rounded-md border border-status-danger/30 bg-status-danger/10 px-2.5 py-1 font-medium text-status-danger">
                        {snapshot.summary.overBudgetCount} Over Budget
                      </span>
                    ) : null}
                    {snapshot.summary.nearLimitCount > 0 ? (
                      <span className="rounded-md border border-status-warning/30 bg-status-warning/10 px-2.5 py-1 font-medium text-status-warning">
                        {snapshot.summary.nearLimitCount} Near Limit
                      </span>
                    ) : null}
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadSnapshot(true)}
                  loading={refreshing}
                  aria-label="Refresh budget data"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>

          {error ? (
            <Card className="border-status-danger/30 bg-status-danger/5 p-4 text-xs text-status-danger">
              {error}
            </Card>
          ) : null}

          {loading || !snapshot ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <Card key={idx} className="h-28 animate-pulse bg-surface-muted/60" />
              ))}
            </div>
          ) : (
            <>
              {/* Multi-Currency Warning */}
              {snapshot.summary.excludedCurrencies.length > 0 ? (
                <Card className="border-status-warning/30 bg-status-warning/10 p-4 text-xs text-ink">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
                      <div>
                        <p className="font-semibold text-ink">
                          Missing Manual FX Rate for{' '}
                          {snapshot.summary.excludedCurrencies.join(', ')}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Totals converted to {baseCurrency} exclude unconvertible currencies so
                          amounts are never distorted. Native values remain shown per category.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/investments"
                      className="inline-flex items-center gap-1 font-medium text-brand-primary hover:underline"
                    >
                      Configure Manual FX <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </Card>
              ) : null}

              {/* Active Local Budget Alerts */}
              {activeAlerts.length > 0 || dismissedAlerts.length > 0 ? (
                <Card className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Bell className="h-4 w-4 text-brand-accent" />
                      <h2 className="text-sm font-semibold text-ink">
                        Budget Alerts ({activeAlerts.length} active)
                      </h2>
                    </div>
                    {dismissedAlerts.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowDismissedAlerts((prev) => !prev)}
                        className="text-xs font-medium text-brand-primary hover:underline"
                      >
                        {showDismissedAlerts
                          ? 'Hide Dismissed'
                          : `Show Dismissed (${dismissedAlerts.length})`}
                      </button>
                    ) : null}
                  </div>

                  {activeAlerts.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {activeAlerts.map((alert) => {
                        const isOver = alert.thresholdType === 'over_budget';
                        return (
                          <div
                            key={alert.id}
                            className={cn(
                              'flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between',
                              isOver
                                ? 'border-status-danger/30 bg-status-danger/10'
                                : 'border-status-warning/30 bg-status-warning/10'
                            )}
                          >
                            <div className="flex items-start gap-2.5">
                              <AlertCircle
                                className={cn(
                                  'mt-0.5 h-4 w-4 shrink-0',
                                  isOver ? 'text-status-danger' : 'text-status-warning'
                                )}
                              />
                              <div>
                                <p className="font-semibold text-ink">
                                  {alert.categoryNameSnapshot} ·{' '}
                                  {alert.thresholdType === 'over_budget'
                                    ? 'Over Budget'
                                    : alert.thresholdType === 'reached_100'
                                      ? 'Budget Reached (100%)'
                                      : `Near Limit (>= ${alert.thresholdPct}%)`}
                                </p>
                                <p className="mt-0.5 text-ink-muted">
                                  Spent{' '}
                                  <span className="font-mono font-medium text-ink">
                                    {formatCurrency(
                                      alert.actualAmount,
                                      alert.currency,
                                      numberFormat
                                    )}
                                  </span>{' '}
                                  of{' '}
                                  <span className="font-mono font-medium text-ink">
                                    {formatCurrency(
                                      alert.budgetAmount,
                                      alert.currency,
                                      numberFormat
                                    )}
                                  </span>{' '}
                                  ({formatSensitiveNumber(alert.utilizationPct, 1)}%)
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleDismissAlert(alert.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                              Dismiss
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">
                      All alerts for {snapshot.periodLabel} have been dismissed.
                    </p>
                  )}

                  {showDismissedAlerts && dismissedAlerts.length > 0 ? (
                    <div className="mt-3 space-y-2 border-t border-line pt-3">
                      {dismissedAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-muted/50 px-3 py-2 text-xs text-ink-muted"
                        >
                          <span>
                            {alert.categoryNameSnapshot} ({formatSensitiveNumber(alert.utilizationPct, 1)}% ·{' '}
                            {alert.thresholdType.replaceAll('_', ' ')})
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleReactivateAlert(alert.id)}
                            className="font-medium text-brand-primary hover:underline"
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Card>
              ) : null}

              {/* Monthly Overview KPI Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Total Monthly Budget</p>
                  <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
                    {formatCurrency(snapshot.summary.totalBudget, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Base {formatCurrency(snapshot.summary.totalBaseLimit, baseCurrency, numberFormat)}
                    {snapshot.summary.totalRollover > 0
                      ? ` + ${formatCurrency(
                          snapshot.summary.totalRollover,
                          baseCurrency,
                          numberFormat
                        )} rollover`
                      : ''}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Actual Budgeted Spending</p>
                  <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
                    {formatCurrency(
                      snapshot.summary.totalActualBudgetedExpenses,
                      baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Total month expenses:{' '}
                    {formatCurrency(
                      snapshot.summary.totalAllMonthExpenses,
                      baseCurrency,
                      numberFormat
                    )}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Remaining Budget</p>
                  <p
                    className={cn(
                      'mt-2 font-mono text-2xl font-bold tabular-nums',
                      snapshot.summary.remainingBudget < 0
                        ? 'text-status-danger'
                        : 'text-status-success'
                    )}
                  >
                    {snapshot.summary.remainingBudget < 0 ? '-' : ''}
                    {formatCurrency(
                      Math.abs(snapshot.summary.remainingBudget),
                      baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {snapshot.summary.remainingBudget < 0
                      ? 'Budgeted categories overspent'
                      : 'Available across active budgets'}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Budget Utilization</p>
                  <p
                    className={cn(
                      'mt-2 font-mono text-2xl font-bold tabular-nums',
                      snapshot.summary.utilizationPct !== null &&
                        snapshot.summary.utilizationPct > 100
                        ? 'text-status-danger'
                        : snapshot.summary.utilizationPct !== null &&
                            snapshot.summary.utilizationPct >= 80
                          ? 'text-status-warning'
                          : 'text-ink'
                    )}
                  >
                    {snapshot.summary.utilizationPct !== null
                      ? `${formatSensitiveNumber(snapshot.summary.utilizationPct, 1)}%`
                      : '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {snapshot.summary.onTrackCount} on track · {snapshot.summary.nearLimitCount}{' '}
                    near · {snapshot.summary.overBudgetCount} over
                  </p>
                </Card>
              </div>

              {/* Optional Monthly Allocation & Rollover Controls */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-brand-accent" />
                        <h2 className="text-sm font-semibold text-ink">
                          Monthly Total Budget Allocation
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        Optional monthly ceiling to track allocated vs. unallocated category budgets.
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setPlanModalOpen(true)}>
                      {snapshot.allocationStatus.hasPlan ? 'Edit Plan' : 'Set Plan'}
                    </Button>
                  </div>

                  {snapshot.allocationStatus.hasPlan &&
                  snapshot.allocationStatus.plannedTotalBudget !== null ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg border border-line bg-surface-muted/50 p-2.5">
                          <p className="text-ink-muted">Planned Cap</p>
                          <p className="mt-1 font-mono font-semibold text-ink">
                            {formatCurrency(
                              snapshot.allocationStatus.plannedTotalBudget,
                              snapshot.allocationStatus.currency,
                              numberFormat
                            )}
                          </p>
                        </div>
                        <div className="rounded-lg border border-line bg-surface-muted/50 p-2.5">
                          <p className="text-ink-muted">Allocated</p>
                          <p className="mt-1 font-mono font-semibold text-ink">
                            {formatCurrency(
                              snapshot.allocationStatus.allocatedBaseLimits,
                              snapshot.allocationStatus.currency,
                              numberFormat
                            )}
                          </p>
                        </div>
                        <div className="rounded-lg border border-line bg-surface-muted/50 p-2.5">
                          <p className="text-ink-muted">
                            {snapshot.allocationStatus.isOverAllocated
                              ? 'Over-Allocated'
                              : 'Unallocated'}
                          </p>
                          <p
                            className={cn(
                              'mt-1 font-mono font-semibold',
                              snapshot.allocationStatus.isOverAllocated
                                ? 'text-status-danger'
                                : 'text-status-success'
                            )}
                          >
                            {formatCurrency(
                              Math.abs(snapshot.allocationStatus.unallocatedAmount ?? 0),
                              snapshot.allocationStatus.currency,
                              numberFormat
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            snapshot.allocationStatus.isOverAllocated
                              ? 'bg-status-danger'
                              : 'bg-brand-accent'
                          )}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, snapshot.allocationStatus.allocationPct ?? 0)
                            )}%`,
                          }}
                        />
                      </div>

                      {snapshot.allocationStatus.isOverAllocated ? (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-status-danger">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Category limits exceed your monthly plan by{' '}
                          {formatCurrency(
                            snapshot.allocationStatus.overAllocatedBy,
                            snapshot.allocationStatus.currency,
                            numberFormat
                          )}
                          .
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-line bg-surface-muted/40 p-3 text-xs text-ink-muted">
                      No monthly spending cap configured for {snapshot.periodLabel}. Your active
                      category budgets currently total{' '}
                      <span className="font-mono font-semibold text-ink">
                        {formatCurrency(
                          snapshot.allocationStatus.allocatedBaseLimits,
                          baseCurrency,
                          numberFormat
                        )}
                      </span>
                      .
                    </div>
                  )}
                </Card>

                <Card className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <PiggyBank className="h-4 w-4 text-brand-accent" />
                        <h2 className="text-sm font-semibold text-ink">
                          Budget Rollover (Opt-In)
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        Disabled by default. Carries forward only positive unused amounts to{' '}
                        {nextMonthInfo.periodKey}; overspending never creates positive rollover.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rolloverEligibleItems.length === 0}
                      onClick={() => setRolloverConfirmOpen(true)}
                    >
                      Apply Rollover
                    </Button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg border border-line bg-surface-muted/50 p-3">
                      <p className="text-ink-muted">Rolled Into {snapshot.periodLabel}</p>
                      <p className="mt-1 font-mono text-sm font-semibold text-ink">
                        {formatCurrency(snapshot.summary.totalRollover, baseCurrency, numberFormat)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-line bg-surface-muted/50 p-3">
                      <p className="text-ink-muted">Rollover-Enabled Categories</p>
                      <p className="mt-1 font-mono text-sm font-semibold text-ink">
                        {rolloverEligibleItems.length} of {snapshot.allActiveItems.length}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Category Budgets List & Filters */}
              <Card className="p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-ink">
                      Category Budgets · {snapshot.periodLabel}
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Click any category&apos;s expense action to inspect matching transactions in
                      the ledger.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input
                      type="search"
                      placeholder="Search category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <Select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as BudgetStatusFilter)}
                      options={STATUS_FILTER_OPTIONS}
                    />
                    <Select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as BudgetSortOption)}
                      options={SORT_OPTIONS}
                    />
                  </div>
                </div>

                {snapshot.items.length === 0 ? (
                  <div className="mt-5">
                    <EmptyState
                      icon={<SlidersHorizontal className="h-5 w-5" />}
                      title={
                        snapshot.allActiveItems.length === 0 && statusFilter !== 'inactive'
                          ? `No category budgets for ${snapshot.periodLabel}`
                          : 'No budgets match your current filter'
                      }
                      description={
                        snapshot.allActiveItems.length === 0 && statusFilter !== 'inactive'
                          ? 'Create a monthly spending limit for an expense category or use Batch Setup to configure multiple categories at once.'
                          : 'Try clearing your search or switching the status filter.'
                      }
                      action={
                        <Button
                          size="sm"
                          onClick={() => {
                            if (snapshot.allActiveItems.length === 0) {
                              setEditingItem(null);
                              setPrefillCategoryId(null);
                              setBudgetModalOpen(true);
                            } else {
                              setStatusFilter('all');
                              setSearchQuery('');
                            }
                          }}
                        >
                          {snapshot.allActiveItems.length === 0 ? 'Add First Budget' : 'Reset Filters'}
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {snapshot.items.map((item) => {
                      const meta = statusBadgeMeta(item);
                      const barPct =
                        item.utilizationPct !== null
                          ? Math.min(100, Math.max(0, item.utilizationPct))
                          : item.actualAmount > 0
                            ? 100
                            : 0;
                      const drilldownUrl = `/transactions?type=expense&categoryId=${encodeURIComponent(
                        item.categoryId
                      )}&startDate=${monthBounds.startDate}&endDate=${monthBounds.endDate}`;

                      return (
                        <div
                          key={item.budget.id}
                          className="rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line/80"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-ink">
                                  {item.categoryName}
                                </span>
                                <span
                                  className={cn(
                                    'rounded-md border px-2 py-0.5 text-[11px] font-medium',
                                    meta.badgeClass
                                  )}
                                >
                                  {meta.label}
                                </span>
                                {item.budget.rolloverEnabled ? (
                                  <span className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                                    Rollover On
                                  </span>
                                ) : null}
                                {item.categoryArchived || item.categoryMissing ? (
                                  <span className="rounded-md border border-line bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                                    Historical Category
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-xs text-ink-muted">
                                Base Limit:{' '}
                                <span className="font-mono text-ink">
                                  {formatCurrency(item.baseLimit, item.currency, numberFormat)}
                                </span>
                                {item.rolloverAmount > 0 ? (
                                  <>
                                    {' '}
                                    + Rollover:{' '}
                                    <span className="font-mono text-status-success">
                                      {formatCurrency(
                                        item.rolloverAmount,
                                        item.currency,
                                        numberFormat
                                      )}
                                    </span>{' '}
                                    = Available:{' '}
                                    <span className="font-mono font-medium text-ink">
                                      {formatCurrency(
                                        item.availableBudget,
                                        item.currency,
                                        numberFormat
                                      )}
                                    </span>
                                  </>
                                ) : null}
                                {' · '}
                                {item.transactionCount} expense
                                {item.transactionCount === 1 ? '' : 's'}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                              <div className="text-left lg:text-right">
                                <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                                  {formatCurrency(item.actualAmount, item.currency, numberFormat)}{' '}
                                  <span className="text-xs font-normal text-ink-muted">
                                    /{' '}
                                    {formatCurrency(
                                      item.availableBudget,
                                      item.currency,
                                      numberFormat
                                    )}
                                  </span>
                                </p>
                                <p
                                  className={cn(
                                    'mt-0.5 text-xs font-medium tabular-nums',
                                    item.remainingAmount < 0
                                      ? 'text-status-danger'
                                      : 'text-status-success'
                                  )}
                                >
                                  {item.remainingAmount < 0
                                    ? `Overspent by ${formatCurrency(
                                        Math.abs(item.remainingAmount),
                                        item.currency,
                                        numberFormat
                                      )}`
                                    : `${formatCurrency(
                                        item.remainingAmount,
                                        item.currency,
                                        numberFormat
                                      )} remaining`}
                                  {' · '}
                                  {item.utilizationPct !== null
                                    ? `${formatSensitiveNumber(item.utilizationPct, 1)}%`
                                    : 'No budget limit'}
                                </p>
                              </div>

                              <div className="flex items-center gap-1">
                                <Link
                                  href={drilldownUrl}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface-muted px-2.5 text-xs font-medium text-ink hover:bg-canvas"
                                >
                                  Expenses
                                  <ArrowRight className="h-3 w-3" />
                                </Link>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingItem(item);
                                    setBudgetModalOpen(true);
                                  }}
                                  aria-label={`Edit ${item.categoryName} budget`}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={actionBusy}
                                  onClick={() => void handleToggleActive(item)}
                                  aria-label={
                                    item.isActive
                                      ? `Deactivate ${item.categoryName} budget`
                                      : `Reactivate ${item.categoryName} budget`
                                  }
                                >
                                  <Power className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={actionBusy}
                                  onClick={() => setDeleteTarget(item)}
                                  aria-label={`Delete ${item.categoryName} budget`}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-status-danger" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                            <div
                              className={cn('h-full rounded-full transition-all', meta.barClass)}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>

                          {item.unconvertedCurrencies.length > 0 ? (
                            <p className="mt-2 text-[11px] text-status-warning">
                              Some expenses in {item.unconvertedCurrencies.join(', ')} could not be
                              converted to {item.currency} without a manual FX rate.
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Unbudgeted Expense Categories */}
              {snapshot.unbudgetedCategories.length > 0 ? (
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-ink">
                        Unbudgeted Spending in {snapshot.periodLabel}
                      </h2>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Expense categories with real spending this month that do not have an active
                        budget yet.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {snapshot.unbudgetedCategories.map((u) => (
                      <div
                        key={`${u.categoryId}:${u.currency}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted/40 p-3"
                      >
                        <div>
                          <p className="text-xs font-semibold text-ink">{u.categoryName}</p>
                          <p className="mt-0.5 font-mono text-xs text-ink-muted">
                            {formatCurrency(u.actualAmount, u.currency, numberFormat)} ·{' '}
                            {u.transactionCount} tx
                          </p>
                        </div>
                        {u.categoryId !== 'uncategorized' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingItem(null);
                              setPrefillCategoryId(u.categoryId);
                              setBudgetModalOpen(true);
                            }}
                          >
                            Set Budget
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              {/* Budget Charts */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card className="p-5">
                  <h2 className="text-sm font-semibold text-ink">
                    Budget vs. Actual · {snapshot.periodLabel}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Available budget (base + rollover) compared with actual category expenses in{' '}
                    {baseCurrency}.
                  </p>
                  <div className="mt-4">
                    <BudgetVsActualComparisonChart
                      items={snapshot.allActiveItems}
                      baseCurrency={baseCurrency}
                      numberFormat={numberFormat}
                    />
                  </div>
                </Card>

                <Card className="p-5">
                  <h2 className="text-sm font-semibold text-ink">
                    Monthly Budget Performance History
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Total active budgets vs. actual budgeted expenses across recent months.
                  </p>
                  <div className="mt-4">
                    <BudgetHistoryTrendChart
                      history={snapshot.history}
                      baseCurrency={baseCurrency}
                      numberFormat={numberFormat}
                    />
                  </div>
                </Card>
              </div>

              {/* Budget History & Month-to-Month Comparison */}
              <Card className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-brand-accent" />
                    <h2 className="text-base font-semibold text-ink">
                      Budget History &amp; Month Comparison
                    </h2>
                  </div>

                  <div className="inline-flex rounded-lg border border-line bg-surface-muted p-1 text-xs">
                    {(
                      [
                        { id: 'monthly', label: 'Monthly Summary' },
                        { id: 'comparison', label: 'vs. Prior Month' },
                        { id: 'category', label: 'By Category' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setHistoryTab(tab.id)}
                        className={cn(
                          'rounded-md px-3 py-1.5 font-medium transition-colors',
                          historyTab === tab.id
                            ? 'bg-surface text-ink shadow-xs'
                            : 'text-ink-muted hover:text-ink'
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {historyTab === 'monthly' ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-line text-ink-muted">
                          <th className="py-2.5 pr-4 font-medium">Month</th>
                          <th className="py-2.5 pr-4 font-medium">Active Budgets</th>
                          <th className="py-2.5 pr-4 font-medium">Total Budget</th>
                          <th className="py-2.5 pr-4 font-medium">Budgeted Actual</th>
                          <th className="py-2.5 pr-4 font-medium">All Expenses</th>
                          <th className="py-2.5 pr-4 font-medium">Utilization</th>
                          <th className="py-2.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {snapshot.history.map((row) => (
                          <tr
                            key={row.periodKey}
                            className={cn(
                              'hover:bg-surface-muted/40',
                              row.periodKey === snapshot.periodKey ? 'bg-brand-accent-soft/40' : ''
                            )}
                          >
                            <td className="py-2.5 pr-4 font-semibold text-ink">{row.label}</td>
                            <td className="py-2.5 pr-4 tabular-nums text-ink-muted">
                              {row.activeBudgetCount}
                            </td>
                            <td className="py-2.5 pr-4 font-mono tabular-nums text-ink">
                              {formatCurrency(row.totalBudget, baseCurrency, numberFormat)}
                            </td>
                            <td className="py-2.5 pr-4 font-mono tabular-nums text-ink">
                              {formatCurrency(
                                row.totalActualBudgetedExpenses,
                                baseCurrency,
                                numberFormat
                              )}
                            </td>
                            <td className="py-2.5 pr-4 font-mono tabular-nums text-ink-muted">
                              {formatCurrency(row.totalAllMonthExpenses, baseCurrency, numberFormat)}
                            </td>
                            <td className="py-2.5 pr-4 font-mono tabular-nums text-ink">
                              {row.utilizationPct !== null
                                ? `${formatSensitiveNumber(row.utilizationPct, 1)}%`
                                : '—'}
                            </td>
                            <td className="py-2.5">
                              {row.overBudgetCount > 0 ? (
                                <span className="font-medium text-status-danger">
                                  {row.overBudgetCount} over
                                </span>
                              ) : row.activeBudgetCount > 0 ? (
                                <span className="inline-flex items-center gap-1 text-status-success">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Within limits
                                </span>
                              ) : (
                                <span className="text-ink-muted">No budgets</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {historyTab === 'comparison' ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Current vs. Previous Total Budget</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-ink">
                          {formatCurrency(
                            snapshot.monthComparison.currentTotalBudget,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Prior ({snapshot.monthComparison.previousPeriodKey}):{' '}
                          {snapshot.monthComparison.previousTotalBudget !== null
                            ? formatCurrency(
                                snapshot.monthComparison.previousTotalBudget,
                                baseCurrency,
                                numberFormat
                              )
                            : 'No prior data'}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Budgeted Actual Variance</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-ink">
                          {formatCurrency(
                            snapshot.monthComparison.currentActual,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          {snapshot.monthComparison.actualChangeAbs !== null ? (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 font-medium',
                                snapshot.monthComparison.actualChangeAbs > 0
                                  ? 'text-status-danger'
                                  : 'text-status-success'
                              )}
                            >
                              {snapshot.monthComparison.actualChangeAbs > 0 ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3" />
                              )}
                              {snapshot.monthComparison.actualChangeAbs >= 0 ? '+' : ''}
                              {formatCurrency(
                                snapshot.monthComparison.actualChangeAbs,
                                baseCurrency,
                                numberFormat
                              )}
                              {snapshot.monthComparison.actualChangePct !== null
                                ? ` (${formatSensitiveSignedNumber(snapshot.monthComparison.actualChangePct, 1)}%)`
                                : ''}
                            </span>
                          ) : (
                            'No prior equivalent spending'
                          )}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Comparison Basis</p>
                        <p className="mt-1 font-semibold text-ink">
                          {snapshot.monthComparison.currentPeriodKey} vs{' '}
                          {snapshot.monthComparison.previousPeriodKey}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Preserves historical category labels automatically.
                        </p>
                      </div>
                    </div>

                    {snapshot.monthComparison.categoryVariances.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[600px] border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-line text-ink-muted">
                              <th className="py-2 pr-4 font-medium">Category</th>
                              <th className="py-2 pr-4 font-medium">Prior Actual</th>
                              <th className="py-2 pr-4 font-medium">Current Actual</th>
                              <th className="py-2 pr-4 font-medium">Actual Delta</th>
                              <th className="py-2 font-medium">Current Budget</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {snapshot.monthComparison.categoryVariances.map((v) => (
                              <tr key={v.categoryId}>
                                <td className="py-2 pr-4 font-medium text-ink">{v.categoryName}</td>
                                <td className="py-2 pr-4 font-mono tabular-nums text-ink-muted">
                                  {formatCurrency(v.previousActual, v.currency, numberFormat)}
                                </td>
                                <td className="py-2 pr-4 font-mono tabular-nums text-ink">
                                  {formatCurrency(v.currentActual, v.currency, numberFormat)}
                                </td>
                                <td
                                  className={cn(
                                    'py-2 pr-4 font-mono tabular-nums',
                                    v.actualDelta > 0
                                      ? 'text-status-danger'
                                      : v.actualDelta < 0
                                        ? 'text-status-success'
                                        : 'text-ink-muted'
                                  )}
                                >
                                  {v.actualDelta >= 0 ? '+' : ''}
                                  {formatCurrency(v.actualDelta, v.currency, numberFormat)}
                                  {v.actualDeltaPct !== null
                                    ? ` (${formatSensitiveSignedNumber(v.actualDeltaPct, 1)}%)`
                                    : ''}
                                </td>
                                <td className="py-2 font-mono tabular-nums text-ink-muted">
                                  {v.currentBudget !== null
                                    ? formatCurrency(v.currentBudget, v.currency, numberFormat)
                                    : 'Unbudgeted'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted">
                        No budgeted category comparison rows for these two months yet.
                      </p>
                    )}
                  </div>
                ) : null}

                {historyTab === 'category' ? (
                  snapshot.categoryHistory.length === 0 ? (
                    <p className="mt-4 text-xs text-ink-muted">
                      No historical category budgets recorded yet.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {snapshot.categoryHistory.map((cat) => (
                        <div
                          key={cat.categoryId}
                          className="rounded-lg border border-line bg-surface-muted/40 p-3"
                        >
                          <p className="text-xs font-semibold text-ink">{cat.categoryName}</p>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                            {cat.months
                              .slice()
                              .reverse()
                              .slice(0, 8)
                              .map((m) => (
                                <div
                                  key={m.periodKey}
                                  className="rounded-md border border-line bg-surface p-2 text-[11px]"
                                >
                                  <p className="font-semibold text-ink">{m.label}</p>
                                  <p className="mt-0.5 font-mono text-ink-muted">
                                    {formatCurrency(m.actualAmount, m.currency, numberFormat)} /{' '}
                                    {formatCurrency(m.availableBudget, m.currency, numberFormat)}
                                  </p>
                                  <p
                                    className={cn(
                                      'mt-0.5 font-medium',
                                      m.status === 'over_budget'
                                        ? 'text-status-danger'
                                        : m.status === 'near_limit'
                                          ? 'text-status-warning'
                                          : 'text-status-success'
                                    )}
                                  >
                                    {m.utilizationPct !== null
                                      ? `${formatSensitiveNumber(m.utilizationPct, 1)}% used`
                                      : 'Over limit'}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : null}
              </Card>
            </>
          )}
        </div>

        {/* Modals */}
        {snapshot && budgetModalOpen ? (
          <CategoryBudgetModal
            key={`${editingItem?.budget.id ?? 'new'}:${prefillCategoryId ?? ''}:${snapshot.periodKey}`}
            open={budgetModalOpen}
            onClose={() => {
              setBudgetModalOpen(false);
              setEditingItem(null);
              setPrefillCategoryId(null);
            }}
            year={selectedYear}
            month={selectedMonth}
            periodLabel={snapshot.periodLabel}
            baseCurrency={baseCurrency}
            numberFormat={numberFormat}
            categories={snapshot.expenseCategories}
            editingItem={editingItem}
            initialCategoryId={prefillCategoryId}
            allocationStatus={snapshot.allocationStatus}
            onSaved={() => void loadSnapshot(true)}
          />
        ) : null}

        {snapshot && batchModalOpen ? (
          <BatchBudgetModal
            key={`batch:${snapshot.periodKey}`}
            open={batchModalOpen}
            onClose={() => setBatchModalOpen(false)}
            year={selectedYear}
            month={selectedMonth}
            periodLabel={snapshot.periodLabel}
            baseCurrency={baseCurrency}
            numberFormat={numberFormat}
            categories={snapshot.expenseCategories}
            existingCategoryIds={existingActiveCategoryIds}
            allocationStatus={snapshot.allocationStatus}
            onSaved={() => void loadSnapshot(true)}
          />
        ) : null}

        {snapshot && planModalOpen ? (
          <MonthlyPlanModal
            key={`plan:${snapshot.periodKey}`}
            open={planModalOpen}
            onClose={() => setPlanModalOpen(false)}
            year={selectedYear}
            month={selectedMonth}
            periodLabel={snapshot.periodLabel}
            baseCurrency={baseCurrency}
            numberFormat={numberFormat}
            allocationStatus={snapshot.allocationStatus}
            onSaved={() => void loadSnapshot(true)}
          />
        ) : null}

        {snapshot && alertSettingsOpen ? (
          <BudgetAlertSettingsModal
            key={`alerts:${snapshot.periodKey}`}
            open={alertSettingsOpen}
            onClose={() => setAlertSettingsOpen(false)}
            alertPreferences={snapshot.alertPreferences}
            onSaved={() => void loadSnapshot(true)}
          />
        ) : null}

        <ConfirmationDialog
          open={Boolean(deleteTarget)}
          title="Delete Category Budget"
          description={
            deleteTarget
              ? `Delete the ${deleteTarget.categoryName} budget for ${
                  snapshot?.periodLabel ?? ''
                }? Existing expense transactions will NOT be affected.`
              : ''
          }
          confirmLabel="Delete Budget"
          tone="danger"
          loading={actionBusy}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />

        <ConfirmationDialog
          open={rolloverConfirmOpen}
          title="Apply Monthly Budget Rollover"
          description={`Carry forward unused positive balances from ${
            snapshot?.periodLabel ?? ''
          } into ${nextMonthInfo.periodKey} for the ${
            rolloverEligibleItems.length
          } rollover-enabled category budget(s)?`}
          details={[
            'Categories that overspent or have zero remaining budget will carry forward 0.',
            'Existing next-month base limits are preserved and never overwritten.',
            'Re-running rollover is safe and updates rollover amounts without duplicating funds.',
          ]}
          confirmLabel="Apply Rollover"
          tone="default"
          loading={actionBusy}
          onConfirm={() => void handleApplyRollover()}
          onCancel={() => setRolloverConfirmOpen(false)}
        />
      </PageContainer>
    </AppLayout>
  );
}
