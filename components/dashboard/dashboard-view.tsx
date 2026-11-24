'use client';

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Info,
  Landmark,
  Lightbulb,
  PiggyBank,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  AssetAllocationBreakdownChart,
  ExpenseBreakdownChart,
  IncomeVsExpenseChart,
  NetWorthTrendChart,
  type NetWorthSeriesKey,
} from '@/components/dashboard/dashboard-charts';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { TransactionDetailModal } from '@/components/transactions/transaction-detail-modal';
import { TransactionFormModal } from '@/components/transactions/transaction-form-modal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency, formatNumericValue } from '@/lib/currency';
import {
  formatDisplayDate,
  formatTimestamp,
  type ReportingPeriodPreset,
} from '@/lib/dates';
import { normalizeErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  getDashboardSnapshot,
  subscribeToDashboardChanges,
  type DashboardSnapshot,
} from '@/services/dashboard.service';
import type { TrendInterval } from '@/services/dashboard-chart.service';
import { listUserAccounts, listUserCategoriesWithCounts } from '@/services/settings.service';
import type { EnrichedTransactionItem } from '@/services/transaction.service';
import type { Account, AccountType, Category, Transaction } from '@/types/entities';

const PERIOD_OPTIONS: Array<{ value: ReportingPeriodPreset; label: string }> = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

const INTERVAL_OPTIONS: Array<{ value: TrendInterval; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank',
  cash: 'Cash',
  ewallet: 'E-Wallet',
  investment_pool: 'Investment Pool',
  investment_cash: 'Platform Cash',
  credit_card: 'Card',
  other: 'Other',
};

const emptySubscribe = () => () => {};

function getGreeting(
  profileName: string,
  timezone: string,
  language: string | undefined,
  overviewTitle: string
): string {
  let hour = 12;
  try {
    const hourStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date());
    const parsed = Number(hourStr);
    if (Number.isFinite(parsed)) hour = parsed;
  } catch {
    hour = new Date().getHours();
  }

  const timeGreeting =
    language === 'id'
      ? hour < 11
        ? 'Selamat pagi'
        : hour < 15
          ? 'Selamat siang'
          : hour < 18
            ? 'Selamat sore'
            : 'Selamat malam'
      : hour < 12
        ? 'Good morning'
        : hour < 17
          ? 'Good afternoon'
          : 'Good evening';
  return profileName ? `${timeGreeting}, ${profileName}` : overviewTitle;
}

function ComparisonLine({
  absChange,
  pctChange,
  currency,
  numberFormat,
  invertPolarity = false,
}: {
  absChange: number | null;
  pctChange: number | null;
  currency: string;
  numberFormat: DashboardSnapshot['numberFormat'];
  invertPolarity?: boolean;
}) {
  if (absChange === null) {
    return (
      <p className="mt-1 text-[11px] text-ink-muted">
        No prior equivalent period comparison
      </p>
    );
  }

  const isPositiveOutcome = invertPolarity ? absChange < 0 : absChange > 0;
  const isNegativeOutcome = invertPolarity ? absChange > 0 : absChange < 0;

  return (
    <p
      className={cn(
        'mt-1 text-[11px] tabular-nums',
        isPositiveOutcome
          ? 'text-status-success'
          : isNegativeOutcome
            ? 'text-status-danger'
            : 'text-ink-muted'
      )}
    >
      {absChange > 0 ? '+' : ''}
      {formatCurrency(absChange, currency, numberFormat)}
      {pctChange !== null ? ` (${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%)` : ''} vs prior
    </p>
  );
}

export function DashboardView() {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const { preferences } = useBootstrap();
  const { language, t, periodLabel } = useI18n();
  const { notifyError } = useNotifications();

  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;
  const baseCurrency = preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const numberFormat = preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  const [periodPreset, setPeriodPreset] = useState<ReportingPeriodPreset>('this_month');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [trendIntervalOverride, setTrendIntervalOverride] = useState<TrendInterval | null>(null);
  const [cashflowIntervalOverride, setCashflowIntervalOverride] = useState<TrendInterval | null>(
    null
  );
  const [trendSeriesKey, setTrendSeriesKey] = useState<NetWorthSeriesKey>('netWorth');
  const [allocationView, setAllocationView] = useState<'total_assets' | 'investment_portfolio'>(
    'total_assets'
  );
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>('all');
  const [showCashBreakdown, setShowCashBreakdown] = useState<boolean>(false);

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState<number>(0);

  // For inspecting/editing a Recent Transaction directly from Dashboard
  const [detailItem, setDetailItem] = useState<EnrichedTransactionItem | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [txAccounts, setTxAccounts] = useState<Account[]>([]);
  const [txCategories, setTxCategories] = useState<Category[]>([]);

  const loadDashboard = useCallback(async () => {
    const [dash, accounts, catRes] = await Promise.all([
      getDashboardSnapshot({
        periodPreset,
        customStart: customStart || null,
        customEnd: customEnd || null,
        trendInterval: trendIntervalOverride ?? undefined,
        cashflowInterval: cashflowIntervalOverride ?? undefined,
        recordOrigin: 'user',
        baseCurrency,
      }),
      listUserAccounts(),
      listUserCategoriesWithCounts(),
    ]);

    return { dash, accounts, categories: catRes.categories };
  }, [
    periodPreset,
    customStart,
    customEnd,
    trendIntervalOverride,
    cashflowIntervalOverride,
    baseCurrency,
  ]);

  useEffect(() => {
    let active = true;
    loadDashboard()
      .then((res) => {
        if (!active) return;
        setSnapshot(res.dash);
        setTxAccounts(res.accounts);
        setTxCategories(res.categories);
        setLoadError(null);
      })
      .catch((err) => {
        if (!active) return;
        const msg = normalizeErrorMessage(err);
        setLoadError(msg);
        notifyError('Failed to load dashboard overview', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadDashboard, reloadTick, notifyError]);

  // Automatic reactivity when local IndexedDB records change
  useEffect(() => {
    const unsubscribe = subscribeToDashboardChanges(() => {
      setReloadTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  const triggerManualRefresh = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  const handleDrillDownExpenseCategory = (categoryId: string) => {
    const params = new URLSearchParams();
    params.set('type', 'expense');
    if (categoryId !== 'uncategorized') {
      params.set('categoryId', categoryId);
    }
    if (snapshot?.dateRange.startDate) params.set('startDate', snapshot.dateRange.startDate);
    if (snapshot?.dateRange.endDate) params.set('endDate', snapshot.dateRange.endDate);
    router.push(`/transactions?${params.toString()}`);
  };

  const handleAccountNavigation = (acc: Account) => {
    if (acc.type === 'investment_pool' || acc.type === 'investment_cash' || acc.isInvestmentPool) {
      router.push('/investments');
      return;
    }
    const params = new URLSearchParams();
    params.set('accountId', acc.id);
    router.push(`/transactions?${params.toString()}`);
  };

  const filteredExpenseItems = useMemo(() => {
    if (!snapshot) return [];
    if (expenseCategoryFilter === 'all') return snapshot.expenseBreakdown.items;
    return snapshot.expenseBreakdown.items.filter(
      (item) => item.categoryId === expenseCategoryFilter
    );
  }, [snapshot, expenseCategoryFilter]);

  const investmentDisplayMetrics = useMemo(() => {
    if (!snapshot) return null;
    const inv = snapshot.investmentOverview;
    if (inv.convertedTotals.canConvertAll) {
      const c = inv.convertedTotals;
      const simpleReturnPct =
        c.netContributions > 0
          ? Math.round((c.totalInvestmentGainLoss / c.netContributions) * 10000) / 100
          : null;
      return {
        currency: c.baseCurrency,
        totalValue: c.totalInvestmentValue,
        netContributions: c.netContributions,
        unrealizedPnl: c.unrealizedPnl,
        realizedPnl: c.realizedPnl,
        simpleReturnPct,
        isConverted: inv.currencies.length > 1,
      };
    }
    const baseBucket =
      inv.byCurrency[snapshot.baseCurrency] ?? Object.values(inv.byCurrency)[0];
    if (!baseBucket) return null;
    return {
      currency: baseBucket.currency,
      totalValue: baseBucket.totalInvestmentValue,
      netContributions: baseBucket.netContributions,
      unrealizedPnl: baseBucket.unrealizedPnl,
      realizedPnl: baseBucket.realizedPnl,
      simpleReturnPct: baseBucket.simpleReturnOnNetContributionsPct,
      isConverted: false,
    };
  }, [snapshot]);

  const localizedPeriodOptions = useMemo(
    () => PERIOD_OPTIONS.map((opt) => ({ value: opt.value, label: periodLabel(opt.value) })),
    [periodLabel]
  );

  const greetingTitle = !isClient
    ? t('page.dashboard.overview')
    : snapshot
      ? getGreeting(snapshot.profileName, snapshot.timezone, language, t('page.dashboard.overview'))
      : getGreeting(preferences?.profileName?.trim() || '', timezone, language, t('page.dashboard.overview'));

  return (
    <AppLayout>
      <PageContainer maxWidth="wide">
        {/* ================================================================
            1. DASHBOARD HEADER
        ================================================================ */}
        <div className="mb-6 flex flex-col justify-between gap-4 border-b border-line pb-5 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{greetingTitle}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                {formatDisplayDate(snapshot?.today ?? undefined, dateFormat)}
              </span>
              <span>
                Base Currency:{' '}
                <strong className="font-mono font-semibold text-ink">
                  {snapshot?.baseCurrency ?? baseCurrency}
                </strong>
              </span>
              {snapshot ? (
                <span className="tabular-nums">
                  Last Updated: {formatTimestamp(snapshot.generatedAt, timezone)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Select
                label="Reporting Period"
                value={periodPreset}
                onChange={(e) => {
                  const next = e.target.value as ReportingPeriodPreset;
                  setPeriodPreset(next);
                  setTrendIntervalOverride(null);
                  setCashflowIntervalOverride(null);
                  setExpenseCategoryFilter('all');
                }}
                options={localizedPeriodOptions}
              />
            </div>

            {periodPreset === 'custom' ? (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink">Start</label>
                  <input
                    type="date"
                    aria-label="Custom start date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="h-10 rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink">End</label>
                  <input
                    type="date"
                    aria-label="Custom end date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="h-10 rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  />
                </div>
              </div>
            ) : null}

            <Button
              variant="outline"
              size="md"
              onClick={triggerManualRefresh}
              aria-label="Refresh dashboard data"
            >
              <RefreshCw
                className={cn('h-4 w-4', loading && 'animate-spin')}
                aria-hidden="true"
              />
              <span>{t('common.refresh')}</span>
            </Button>
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading && !snapshot ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Card key={idx} padding="md">
                  <div className="h-4 w-28 animate-pulse rounded bg-surface-muted" />
                  <div className="mt-3 h-7 w-40 animate-pulse rounded bg-surface-muted" />
                  <div className="mt-2 h-3 w-32 animate-pulse rounded bg-surface-muted" />
                </Card>
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card padding="lg">
                <div className="h-64 animate-pulse rounded bg-surface-muted" />
              </Card>
              <Card padding="lg">
                <div className="h-64 animate-pulse rounded bg-surface-muted" />
              </Card>
            </div>
          </div>
        ) : null}

        {/* Error State */}
        {loadError && !snapshot ? (
          <Card padding="lg" className="border-status-danger/40 bg-status-danger/5">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-status-danger" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-ink">Unable to load Dashboard</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{loadError}</p>
                </div>
              </div>
              <Button size="sm" onClick={triggerManualRefresh}>
                Try Again
              </Button>
            </div>
          </Card>
        ) : null}

        {snapshot ? (
          <div className="space-y-6">
            {/* Multi-Currency Conversion Disclosure */}
            {snapshot.metrics.excludedCurrencies.length > 0 ? (
              <Card padding="sm" className="border-status-warning/50 bg-status-warning/10">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="text-xs text-ink">
                    <p className="font-semibold">
                      Foreign currency balances excluded from {snapshot.baseCurrency} totals:{' '}
                      <span className="font-mono">
                        {snapshot.metrics.excludedCurrencies.join(', ')}
                      </span>
                    </p>
                    <p className="mt-0.5 text-ink-muted">
                      {snapshot.metrics.excludedCurrencyItems.length > 0
                        ? snapshot.metrics.excludedCurrencyItems
                            .map(
                              (item) =>
                                `${item.currency}: ${formatCurrency(
                                  item.totalValue,
                                  item.currency,
                                  numberFormat
                                )}`
                            )
                            .join(' · ')
                        : 'No manual FX rate recorded yet.'}{' '}
                      — Set explicit manual FX rates on the Investments page to consolidate them
                      safely.
                    </p>
                  </div>
                  <Link href="/investments">
                    <Button variant="outline" size="sm">
                      Manage FX Rates
                    </Button>
                  </Link>
                </div>
              </Card>
            ) : null}

            {/* ================================================================
                2. KEY FINANCIAL METRICS (POINT-IN-TIME VS PERIOD)
            ================================================================ */}
            <section aria-label="Key Financial Metrics" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                <span>
                  <strong className="text-ink">Point-in-Time Balances</strong> reflect current
                  totals; <strong className="text-ink">Cash Flow Metrics</strong> reflect the
                  selected reporting period
                  {snapshot.dateRange.startDate && snapshot.dateRange.endDate
                    ? ` (${formatDisplayDate(snapshot.dateRange.startDate, dateFormat)} – ${formatDisplayDate(
                        snapshot.dateRange.endDate,
                        dateFormat
                      )})`
                    : ' (All Time)'}
                  .
                </span>
              </div>

              {/* Row 1: Point-in-Time Asset Metrics */}
              <div className="grid gap-4 md:grid-cols-3">
                {/* Primary Highlighted Card: Net Worth */}
                <Card
                  padding="md"
                  className="border-brand-primary/30 bg-surface"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-ink-muted">
                        Net Worth ({snapshot.baseCurrency})
                      </p>
                      <span
                        title="Net Worth = Total Eligible Financial Assets (Bank, Cash, E-Wallet, Investment Pool, Platform Cash, and Holdings Market Value). Liability tracking is not yet active."
                        className="text-ink-muted"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-brand-primary dark:text-brand-secondary">
                      Point-in-Time
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-brand-primary dark:text-brand-secondary">
                    {formatCurrency(
                      snapshot.metrics.netWorth,
                      snapshot.baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Total Eligible Financial Assets (Cash + Investments)
                  </p>
                </Card>

                {/* Available Cash */}
                <Card padding="md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-ink-muted">
                        Available Cash ({snapshot.baseCurrency})
                      </p>
                      <span
                        title="Includes active Bank, Cash, and E-Wallet accounts. Excludes Investment Pool, Platform Cash, and Holdings."
                        className="text-ink-muted"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </div>
                    <Wallet className="h-4 w-4 text-brand-accent" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-ink">
                    {formatCurrency(
                      snapshot.metrics.availableCash,
                      snapshot.baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
                    <span>
                      {snapshot.availableCashAccounts.length} active spending account
                      {snapshot.availableCashAccounts.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCashBreakdown((v) => !v)}
                      className="inline-flex items-center gap-0.5 font-medium text-brand-accent hover:underline"
                    >
                      <span>{showCashBreakdown ? 'Hide' : 'Breakdown'}</span>
                      {showCashBreakdown ? (
                        <ChevronUp className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3 w-3" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {showCashBreakdown && snapshot.availableCashAccounts.length > 0 ? (
                    <div className="mt-3 space-y-1 border-t border-line pt-2 text-xs tabular-nums">
                      {snapshot.availableCashAccounts.map((acc) => (
                        <div key={acc.account.id} className="flex justify-between gap-2">
                          <span className="truncate text-ink-muted">{acc.account.name}</span>
                          <span className="shrink-0 font-medium text-ink">
                            {formatCurrency(
                              acc.currentBalance,
                              acc.account.currency,
                              numberFormat
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Card>

                {/* Investment Value */}
                <Card padding="md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-ink-muted">
                        Investment Value ({snapshot.baseCurrency})
                      </p>
                      <span
                        title="Includes Investment Pool + Platform Cash + Current Market Value of Holdings from Stage 4."
                        className="text-ink-muted"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </div>
                    <PiggyBank className="h-4 w-4 text-brand-secondary" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-ink">
                    {formatCurrency(
                      snapshot.metrics.investmentValue,
                      snapshot.baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
                    <span>Pool + Platform Cash + Holdings</span>
                    <Link
                      href="/investments"
                      className="font-medium text-brand-accent hover:underline"
                    >
                      Open Portfolio
                    </Link>
                  </div>
                </Card>
              </div>

              {/* Row 2: Period-Based Cash Flow Metrics */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card padding="md">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-ink-muted">
                      Total Income ({snapshot.baseCurrency})
                    </p>
                    <ArrowDownLeft className="h-4 w-4 text-status-success" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums text-status-success">
                    {formatCurrency(
                      snapshot.metrics.periodIncome,
                      snapshot.baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <ComparisonLine
                    absChange={snapshot.metrics.comparison.incomeChangeAbs}
                    pctChange={snapshot.metrics.comparison.incomeChangePct}
                    currency={snapshot.baseCurrency}
                    numberFormat={numberFormat}
                  />
                </Card>

                <Card padding="md">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-ink-muted">
                      Total Expenses ({snapshot.baseCurrency})
                    </p>
                    <ArrowUpRight className="h-4 w-4 text-status-danger" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums text-status-danger">
                    {formatCurrency(
                      snapshot.metrics.periodExpenses,
                      snapshot.baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <ComparisonLine
                    absChange={snapshot.metrics.comparison.expenseChangeAbs}
                    pctChange={snapshot.metrics.comparison.expenseChangePct}
                    currency={snapshot.baseCurrency}
                    numberFormat={numberFormat}
                    invertPolarity
                  />
                </Card>

                <Card padding="md">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-ink-muted">
                      Net Cash Flow / Savings ({snapshot.baseCurrency})
                    </p>
                    {snapshot.metrics.periodNetCashFlow >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-status-success" aria-hidden="true" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-status-danger" aria-hidden="true" />
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-2 text-xl font-semibold tracking-tight tabular-nums',
                      snapshot.metrics.periodNetCashFlow > 0
                        ? 'text-status-success'
                        : snapshot.metrics.periodNetCashFlow < 0
                          ? 'text-status-danger'
                          : 'text-ink'
                    )}
                  >
                    {snapshot.metrics.periodNetCashFlow > 0 ? '+' : ''}
                    {formatCurrency(
                      snapshot.metrics.periodNetCashFlow,
                      snapshot.baseCurrency,
                      numberFormat
                    )}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
                    {snapshot.metrics.savingsRatePct !== null
                      ? `Savings Rate: ${snapshot.metrics.savingsRatePct.toFixed(1)}% of income`
                      : 'Savings Rate unavailable (no income in period)'}
                  </p>
                </Card>
              </div>
            </section>

            {/* ================================================================
                3 & 4. NET WORTH TREND + INCOME VS EXPENSES CHARTS
            ================================================================ */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card padding="md" className="lg:col-span-6">
                <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Net Worth Trend</h2>
                    <p className="text-[11px] text-ink-muted">
                      Snapshots: {snapshot.netWorthTrend.snapshotPointCount} · Reconstructed:{' '}
                      {snapshot.netWorthTrend.reconstructedPointCount}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'netWorth', label: 'Net Worth' },
                        { id: 'availableCash', label: 'Cash' },
                        { id: 'investmentValue', label: 'Investments' },
                      ] as const
                    ).map((btn) => (
                      <button
                        key={btn.id}
                        type="button"
                        onClick={() => setTrendSeriesKey(btn.id)}
                        className={cn(
                          'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
                          trendSeriesKey === btn.id
                            ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                            : 'border-line bg-surface text-ink-muted hover:bg-surface-muted'
                        )}
                      >
                        {btn.label}
                      </button>
                    ))}
                    <div className="w-24">
                      <Select
                        aria-label="Net worth trend interval"
                        value={trendIntervalOverride ?? snapshot.netWorthTrend.interval}
                        onChange={(e) => setTrendIntervalOverride(e.target.value as TrendInterval)}
                        options={INTERVAL_OPTIONS}
                      />
                    </div>
                  </div>
                </div>
                <NetWorthTrendChart
                  points={snapshot.netWorthTrend.points}
                  hasSufficientData={snapshot.netWorthTrend.hasSufficientData}
                  insufficientReason={snapshot.netWorthTrend.insufficientReason}
                  seriesKey={trendSeriesKey}
                  currency={snapshot.baseCurrency}
                  numberFormat={numberFormat}
                  dateFormat={dateFormat}
                />
              </Card>

              <Card padding="md" className="lg:col-span-6">
                <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Income vs Expenses</h2>
                    <p className="text-[11px] text-ink-muted">
                      Excludes internal transfers, contributions, and asset purchases
                    </p>
                  </div>
                  <div className="w-28">
                    <Select
                      aria-label="Income vs expenses interval"
                      value={cashflowIntervalOverride ?? snapshot.incomeVsExpenses.interval}
                      onChange={(e) =>
                        setCashflowIntervalOverride(e.target.value as TrendInterval)
                      }
                      options={INTERVAL_OPTIONS}
                    />
                  </div>
                </div>
                <IncomeVsExpenseChart
                  points={snapshot.incomeVsExpenses.points}
                  currency={snapshot.baseCurrency}
                  numberFormat={numberFormat}
                />
              </Card>
            </div>

            {/* ================================================================
                5 & 6. ASSET ALLOCATION + EXPENSE BREAKDOWN
            ================================================================ */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card padding="md" className="lg:col-span-6">
                <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Asset Allocation</h2>
                    <p className="text-[11px] text-ink-muted">
                      Positive eligible financial assets in {snapshot.baseCurrency}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAllocationView('total_assets')}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        allocationView === 'total_assets'
                          ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                          : 'border-line bg-surface text-ink-muted hover:bg-surface-muted'
                      )}
                    >
                      Total Assets
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllocationView('investment_portfolio')}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        allocationView === 'investment_portfolio'
                          ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                          : 'border-line bg-surface text-ink-muted hover:bg-surface-muted'
                      )}
                    >
                      Investment Portfolio
                    </button>
                  </div>
                </div>

                <AssetAllocationBreakdownChart
                  items={
                    allocationView === 'total_assets'
                      ? snapshot.assetAllocation.totalAssetsItems
                      : snapshot.assetAllocation.investmentOnlyItems
                  }
                  currency={snapshot.baseCurrency}
                  numberFormat={numberFormat}
                  emptyMessage={
                    allocationView === 'total_assets'
                      ? 'Add balances or holdings to view your Total Financial Asset allocation.'
                      : 'Add valued investment holdings in Stage 4 to view your asset-class allocation.'
                  }
                />
              </Card>

              <Card padding="md" className="lg:col-span-6">
                <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Expense Breakdown</h2>
                    <p className="text-[11px] text-ink-muted">
                      Click any category row to inspect transactions in that category
                    </p>
                  </div>
                  {snapshot.expenseBreakdown.items.length > 0 ? (
                    <div className="w-44">
                      <Select
                        aria-label="Filter expense breakdown category"
                        value={expenseCategoryFilter}
                        onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                        options={[
                          { value: 'all', label: 'All Categories' },
                          ...snapshot.expenseBreakdown.items.map((item) => ({
                            value: item.categoryId,
                            label: item.categoryName,
                          })),
                        ]}
                      />
                    </div>
                  ) : null}
                </div>

                <ExpenseBreakdownChart
                  items={filteredExpenseItems}
                  currency={snapshot.baseCurrency}
                  numberFormat={numberFormat}
                  onSelectCategory={handleDrillDownExpenseCategory}
                />
              </Card>
            </div>

            {/* ================================================================
                7 & 8. INVESTMENT OVERVIEW + ACCOUNT BALANCES
            ================================================================ */}
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Investment Overview */}
              <Card padding="md" className="lg:col-span-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Investment Overview</h2>
                    <p className="text-[11px] text-ink-muted">
                      Consolidated from Stage 4 Portfolio Engine
                    </p>
                  </div>
                  <Link href="/investments">
                    <Button variant="outline" size="sm">
                      <span>Open Investments</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </Link>
                </div>

                {investmentDisplayMetrics ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
                        <p className="text-[11px] text-ink-muted">Total Value</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                          {formatCurrency(
                            investmentDisplayMetrics.totalValue,
                            investmentDisplayMetrics.currency,
                            numberFormat
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
                        <p className="text-[11px] text-ink-muted">Net Contributions</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                          {formatCurrency(
                            investmentDisplayMetrics.netContributions,
                            investmentDisplayMetrics.currency,
                            numberFormat
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
                        <p className="text-[11px] text-ink-muted">Unrealized P/L</p>
                        <p
                          className={cn(
                            'mt-1 text-sm font-semibold tabular-nums',
                            investmentDisplayMetrics.unrealizedPnl > 0
                              ? 'text-status-success'
                              : investmentDisplayMetrics.unrealizedPnl < 0
                                ? 'text-status-danger'
                                : 'text-ink'
                          )}
                        >
                          {investmentDisplayMetrics.unrealizedPnl > 0 ? '+' : ''}
                          {formatCurrency(
                            investmentDisplayMetrics.unrealizedPnl,
                            investmentDisplayMetrics.currency,
                            numberFormat
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
                        <p className="text-[11px] text-ink-muted">Realized P/L</p>
                        <p
                          className={cn(
                            'mt-1 text-sm font-semibold tabular-nums',
                            investmentDisplayMetrics.realizedPnl > 0
                              ? 'text-status-success'
                              : investmentDisplayMetrics.realizedPnl < 0
                                ? 'text-status-danger'
                                : 'text-ink'
                          )}
                        >
                          {investmentDisplayMetrics.realizedPnl > 0 ? '+' : ''}
                          {formatCurrency(
                            investmentDisplayMetrics.realizedPnl,
                            investmentDisplayMetrics.currency,
                            numberFormat
                          )}
                        </p>
                      </div>
                    </div>

                    {investmentDisplayMetrics.simpleReturnPct !== null ? (
                      <p className="text-xs tabular-nums text-ink-muted">
                        Simple Return on Net Contributions:{' '}
                        <strong className="text-ink">
                          {investmentDisplayMetrics.simpleReturnPct > 0 ? '+' : ''}
                          {investmentDisplayMetrics.simpleReturnPct.toFixed(2)}%
                        </strong>
                      </p>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold text-ink">Top Holdings</p>
                        {snapshot.investmentOverview.holdings.filter((h) => h.quantity > 0).length ===
                        0 ? (
                          <p className="text-xs text-ink-muted">No open holdings yet.</p>
                        ) : (
                          <div className="divide-y divide-line rounded-lg border border-line">
                            {snapshot.investmentOverview.holdings
                              .filter((h) => h.quantity > 0)
                              .slice(0, 4)
                              .map((h) => (
                                <div
                                  key={h.holding.id}
                                  className="flex items-center justify-between px-3 py-2 text-xs"
                                >
                                  <div>
                                    <p className="font-semibold text-ink">{h.holding.symbol}</p>
                                    <p className="text-[11px] text-ink-muted">
                                      {h.platformName} ·{' '}
                                      <span className="font-mono tabular-nums">
                                        {formatNumericValue(
                                          h.quantity,
                                          h.quantity % 1 === 0 ? 0 : 4,
                                          numberFormat
                                        )}
                                      </span>
                                    </p>
                                  </div>
                                  <span className="font-semibold tabular-nums text-ink">
                                    {formatCurrency(h.marketValue, h.holding.currency, numberFormat)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold text-ink">Platform Distribution</p>
                        {snapshot.investmentOverview.platforms.filter((p) => !p.platform.isArchived)
                          .length === 0 ? (
                          <p className="text-xs text-ink-muted">No active platforms.</p>
                        ) : (
                          <div className="divide-y divide-line rounded-lg border border-line">
                            {snapshot.investmentOverview.platforms
                              .filter((p) => !p.platform.isArchived)
                              .slice(0, 4)
                              .map((p) => (
                                <div
                                  key={p.platform.id}
                                  className="flex items-center justify-between px-3 py-2 text-xs"
                                >
                                  <div>
                                    <p className="font-medium text-ink">{p.platform.name}</p>
                                    <p className="text-[11px] text-ink-muted">{p.currency}</p>
                                  </div>
                                  <span className="font-semibold tabular-nums text-ink">
                                    {formatCurrency(p.totalPlatformValue, p.currency, numberFormat)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">
                    No investment activity or holdings recorded yet.
                  </p>
                )}
              </Card>

              {/* Account Balances Grouped by Type */}
              <Card padding="md" className="lg:col-span-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Account Balances</h2>
                    <p className="text-[11px] text-ink-muted">
                      Active local accounts grouped by type (click to inspect activity)
                    </p>
                  </div>
                  <Link href="/profile">
                    <Button variant="ghost" size="sm">
                      Manage Accounts
                    </Button>
                  </Link>
                </div>

                {snapshot.groupedAccountBalances.every((g) => g.items.length === 0) ? (
                  <EmptyState
                    icon={<Landmark className="h-5 w-5" />}
                    title="No active accounts"
                    description="Create a Bank, Cash, or E-Wallet account in Profile & Settings to start tracking balances."
                  />
                ) : (
                  <div className="space-y-4">
                    {snapshot.groupedAccountBalances
                      .filter((group) => group.items.length > 0)
                      .map((group) => (
                        <div key={group.groupKey}>
                          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                            <span>{group.groupLabel}</span>
                            <span className="font-mono tabular-nums">
                              {Object.entries(group.totalsByCurrency)
                                .map(([cur, amt]) => formatCurrency(amt, cur, numberFormat))
                                .join(' · ')}
                            </span>
                          </div>
                          <div className="divide-y divide-line rounded-lg border border-line">
                            {group.items.map((item) => (
                              <button
                                key={item.account.id}
                                type="button"
                                onClick={() => handleAccountNavigation(item.account)}
                                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-surface-muted/50"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink">
                                    {item.account.name}
                                  </p>
                                  <p className="text-[11px] text-ink-muted">
                                    {ACCOUNT_TYPE_LABELS[item.account.type]} ·{' '}
                                    <span className="font-mono">{item.account.currency}</span>
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    'shrink-0 font-semibold tabular-nums',
                                    item.currentBalance < 0 ? 'text-status-danger' : 'text-ink'
                                  )}
                                >
                                  {formatCurrency(
                                    item.currentBalance,
                                    item.account.currency,
                                    numberFormat
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </Card>
            </div>

            {/* ================================================================
                9 & 10. RECENT TRANSACTIONS + FINANCIAL INSIGHTS
            ================================================================ */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card padding="none" className="overflow-hidden lg:col-span-7">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Recent Transactions</h2>
                    <p className="text-[11px] text-ink-muted">
                      Latest logical records (paired transfers displayed once)
                    </p>
                  </div>
                  <Link href="/transactions">
                    <Button variant="outline" size="sm">
                      <span>View All</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </Link>
                </div>

                {snapshot.recentTransactions.length === 0 ? (
                  <div className="px-5 py-10 text-center text-xs text-ink-muted">
                    No transactions recorded yet. Add your first income, expense, or transfer on the
                    Transactions page.
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    {snapshot.recentTransactions.map((item) => {
                      const tx = item.transaction;
                      return (
                        <div
                          key={tx.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setDetailItem(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetailItem(item);
                            }
                          }}
                          className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-xs transition-colors hover:bg-surface-muted/50"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line',
                                tx.type === 'income'
                                  ? 'bg-status-success/10 text-status-success'
                                  : tx.type === 'expense'
                                    ? 'bg-status-danger/10 text-status-danger'
                                    : 'bg-brand-secondary/10 text-brand-secondary'
                              )}
                            >
                              {tx.type === 'income' ? (
                                <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                              ) : tx.type === 'expense' ? (
                                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink">{tx.description}</p>
                              <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                                <span className="tabular-nums">
                                  {formatDisplayDate(tx.date, dateFormat)}
                                </span>{' '}
                                · {item.categoryName || 'Transfer'} ·{' '}
                                {tx.type === 'transfer'
                                  ? `${item.accountName} -> ${item.destinationAccountName ?? '—'}`
                                  : item.accountName}
                              </p>
                            </div>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 font-semibold tabular-nums',
                              tx.type === 'income'
                                ? 'text-status-success'
                                : tx.type === 'expense'
                                  ? 'text-status-danger'
                                  : 'text-ink'
                            )}
                          >
                            {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                            {formatCurrency(tx.amount, tx.currency, numberFormat)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card padding="md" className="lg:col-span-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Financial Insights</h2>
                    <p className="text-[11px] text-ink-muted">
                      Deterministic observations derived from local records
                    </p>
                  </div>
                  <Lightbulb className="h-4 w-4 text-brand-accent" aria-hidden="true" />
                </div>

                {snapshot.insights.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line bg-surface-muted/40 px-4 py-8 text-center text-xs leading-relaxed text-ink-muted">
                    Insufficient data for automated insights in this period. Insights will appear as
                    you log transactions, balances, and investments.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {snapshot.insights.map((insight) => (
                      <div
                        key={insight.id}
                        className={cn(
                          'rounded-lg border px-3.5 py-2.5 text-xs',
                          insight.tone === 'positive'
                            ? 'border-status-success/30 bg-status-success/5'
                            : insight.tone === 'warning'
                              ? 'border-status-warning/40 bg-status-warning/5'
                              : 'border-line bg-surface-muted/40'
                        )}
                      >
                        <p className="font-semibold text-ink">{insight.title}</p>
                        <p className="mt-0.5 leading-relaxed text-ink-muted">
                          {insight.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        ) : null}
      </PageContainer>

      {/* Detail & Edit Modals for Recent Transactions */}
      <TransactionDetailModal
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onEdit={(item) => setEditingTx(item.transaction)}
        onDeleted={triggerManualRefresh}
        numberFormat={numberFormat}
        dateFormat={dateFormat}
        timezone={timezone}
      />

      <TransactionFormModal
        open={Boolean(editingTx)}
        onClose={() => setEditingTx(null)}
        onSaved={triggerManualRefresh}
        accounts={txAccounts}
        categories={txCategories}
        timezone={timezone}
        initialTransaction={editingTx}
      />
    </AppLayout>
  );
}
