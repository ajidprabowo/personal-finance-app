'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  Filter,
  Info,
  Landmark,
  Lightbulb,
  PiggyBank,
  RefreshCw,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  ExpenseCategoryDonutChart,
  ExpenseCategoryHorizontalChart,
  ExpenseTrendSeriesChart,
  IncomeTrendChart,
  InvestmentActivityHistoryChart,
  InvestmentValueHistoryChart,
  NetWorthAnalyticsTrendChart,
  SavingsMonthlyTrendChart,
} from '@/components/analytics/analytics-charts';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useI18n } from '@/hooks/use-i18n';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import {
  formatPrivacySensitiveText,
  formatSensitiveNumber,
  formatSensitiveSignedNumber,
} from '@/lib/privacy-mode';
import { formatDisplayDate, type ReportingPeriodPreset } from '@/lib/dates';
import { normalizeErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  getAnalyticsSnapshot,
  subscribeToAnalyticsChanges,
  type AnalyticsSnapshot,
  type HealthIndicatorStatus,
} from '@/services/analytics.service';

const PERIOD_OPTIONS: Array<{ value: ReportingPeriodPreset; label: string }> = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'last_12_months', label: 'Last 12 Months' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

type AnalyticsSectionTab =
  | 'all'
  | 'cashflow'
  | 'behavior_savings'
  | 'investments_networth'
  | 'health_insights';

const SECTION_TABS: Array<{ id: AnalyticsSectionTab; label: string }> = [
  { id: 'all', label: 'Full Report' },
  { id: 'cashflow', label: 'Income & Expenses' },
  { id: 'behavior_savings', label: 'Behavior & Savings' },
  { id: 'investments_networth', label: 'Investments & Net Worth' },
  { id: 'health_insights', label: 'Health & Insights' },
];

function healthStatusStyles(status: HealthIndicatorStatus): {
  label: string;
  badge: string;
} {
  if (status === 'healthy') {
    return {
      label: 'On Track',
      badge: 'border-status-success/30 bg-status-success/10 text-status-success',
    };
  }
  if (status === 'caution') {
    return {
      label: 'Moderate',
      badge: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
    };
  }
  if (status === 'attention') {
    return {
      label: 'Elevated',
      badge: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
    };
  }
  return {
    label: 'Insufficient Data',
    badge: 'border-line bg-surface-muted text-ink-muted',
  };
}

export function AnalyticsView() {
  const router = useRouter();
  const { preferences } = useBootstrap();
  const { t, periodLabel } = useI18n();

  const [periodPreset, setPeriodPreset] = useState<ReportingPeriodPreset>('last_6_months');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('all');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [transactionType, setTransactionType] = useState<'all' | 'income' | 'expense'>('all');
  const [platformId, setPlatformId] = useState<string>('all');
  const [assetClassId, setAssetClassId] = useState<string>('all');
  const [holdingId, setHoldingId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<AnalyticsSectionTab>('all');
  const [expenseChartMode, setExpenseChartMode] = useState<'monthly' | 'daily'>('monthly');

  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await getAnalyticsSnapshot({
          periodPreset,
          customStart: customStart || null,
          customEnd: customEnd || null,
          accountId,
          categoryId,
          transactionType,
          platformId,
          assetClassId,
          holdingId,
        });
        setSnapshot(data);
      } catch (err) {
        setError(normalizeErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      periodPreset,
      customStart,
      customEnd,
      accountId,
      categoryId,
      transactionType,
      platformId,
      assetClassId,
      holdingId,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    getAnalyticsSnapshot({
      periodPreset,
      customStart: customStart || null,
      customEnd: customEnd || null,
      accountId,
      categoryId,
      transactionType,
      platformId,
      assetClassId,
      holdingId,
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
  }, [
    periodPreset,
    customStart,
    customEnd,
    accountId,
    categoryId,
    transactionType,
    platformId,
    assetClassId,
    holdingId,
  ]);

  useEffect(() => {
    return subscribeToAnalyticsChanges(() => {
      void loadSnapshot(true);
    });
  }, [loadSnapshot]);

  const resetFilters = () => {
    setPeriodPreset('last_6_months');
    setCustomStart('');
    setCustomEnd('');
    setAccountId('all');
    setCategoryId('all');
    setTransactionType('all');
    setPlatformId('all');
    setAssetClassId('all');
    setHoldingId('all');
  };

  const baseCurrency =
    snapshot?.overview.currency ?? preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const numberFormat =
    snapshot?.numberFormat ?? preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat =
    snapshot?.dateFormat ?? preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  const navigateToExpenseCategory = (catId: string) => {
    const params = new URLSearchParams();
    params.set('type', 'expense');
    if (catId !== 'uncategorized') params.set('categoryId', catId);
    if (snapshot?.context.dateRange.startDate) {
      params.set('startDate', snapshot.context.dateRange.startDate);
    }
    if (snapshot?.context.dateRange.endDate) {
      params.set('endDate', snapshot.context.dateRange.endDate);
    }
    router.push(`/transactions?${params.toString()}`);
  };

  const showSection = (group: Exclude<AnalyticsSectionTab, 'all'>) =>
    activeTab === 'all' || activeTab === group;

  return (
    <AppLayout>
      <PageContainer maxWidth="wide">
        <PageHeader
          title={t('page.analytics.title')}
          description={t('page.analytics.description')}
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('common.reset')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadSnapshot(true)}
                loading={refreshing}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('common.refresh')}
              </Button>
            </div>
          }
        />
        <div className="space-y-6">
          {/* Global Analytics Filter Toolbar */}
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink">
              <Filter className="h-3.5 w-3.5 text-brand-accent" />
              <span>Analytics Filters</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Select
                label="Reporting Period"
                value={periodPreset}
                onChange={(e) => setPeriodPreset(e.target.value as ReportingPeriodPreset)}
                options={PERIOD_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: periodLabel(opt.value),
                }))}
              />
              <Select
                label="Account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                options={[
                  { value: 'all', label: 'All Accounts' },
                  ...(snapshot?.filterOptions.accounts ?? []).map((a) => ({
                    value: a.id,
                    label: `${a.name} (${a.currency})`,
                  })),
                ]}
              />
              <Select
                label="Category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                options={[
                  { value: 'all', label: 'All Categories' },
                  ...(snapshot?.filterOptions.categories ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.name} (${c.kind})`,
                  })),
                ]}
              />
              <Select
                label="Cashflow Type"
                value={transactionType}
                onChange={(e) =>
                  setTransactionType(e.target.value as 'all' | 'income' | 'expense')
                }
                options={[
                  { value: 'all', label: 'Income & Expense' },
                  { value: 'income', label: 'Income Only' },
                  { value: 'expense', label: 'Expense Only' },
                ]}
              />
              <Select
                label="Investment Platform"
                value={platformId}
                onChange={(e) => setPlatformId(e.target.value)}
                options={[
                  { value: 'all', label: 'All Platforms' },
                  ...(snapshot?.filterOptions.platforms ?? []).map((p) => ({
                    value: p.id,
                    label: p.name,
                  })),
                ]}
              />
              <Select
                label="Asset Class"
                value={assetClassId}
                onChange={(e) => setAssetClassId(e.target.value)}
                options={[
                  { value: 'all', label: 'All Asset Classes' },
                  ...(snapshot?.filterOptions.assetClasses ?? []).map((ac) => ({
                    value: ac.id,
                    label: ac.name,
                  })),
                ]}
              />
            </div>

            {periodPreset === 'custom' ? (
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-3">
                <Input
                  label="Start Date"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <Input
                  label="End Date"
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
                <Select
                  label="Holding Filter"
                  value={holdingId}
                  onChange={(e) => setHoldingId(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Holdings' },
                    ...(snapshot?.filterOptions.holdings ?? []).map((h) => ({
                      value: h.id,
                      label: `${h.symbol} — ${h.name}`,
                    })),
                  ]}
                />
              </div>
            ) : null}

            {/* Section View Switcher */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              {SECTION_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-brand-primary text-brand-primary-foreground'
                      : 'border border-line bg-surface-muted text-ink-muted hover:text-ink'
                  )}
                >
                  {tab.label}
                </button>
              ))}
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
              {/* Multi-Currency Notice */}
              {snapshot.excludedCurrencies.length > 0 ? (
                <Card className="border-status-warning/30 bg-status-warning/10 p-4 text-xs text-ink">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
                      <div>
                        <p className="font-semibold">
                          Excluded Currencies Without Manual FX Rate:{' '}
                          {snapshot.excludedCurrencies.join(', ')}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Amounts in currencies lacking a manual exchange rate to {baseCurrency}{' '}
                          are excluded rather than converted with guessed rates.
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/investments"
                      className="inline-flex items-center gap-1 font-medium text-brand-primary hover:underline"
                    >
                      Add Manual FX Rate <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </Card>
              ) : null}

              {/* 1. Financial Overview Strip */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Period Income</p>
                  <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-status-success">
                    {formatCurrency(snapshot.overview.totalIncome, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Avg/mo:{' '}
                    {formatCurrency(snapshot.income.averageMonthlyIncome, baseCurrency, numberFormat)}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Period Expenses</p>
                  <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-ink">
                    {formatCurrency(snapshot.overview.totalExpenses, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Avg/mo:{' '}
                    {formatCurrency(
                      snapshot.expenses.averageMonthlyExpenses,
                      baseCurrency,
                      numberFormat
                    )}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Net Savings &amp; Rate</p>
                  <p
                    className={cn(
                      'mt-1.5 font-mono text-xl font-bold tabular-nums',
                      snapshot.overview.netSavings < 0 ? 'text-status-danger' : 'text-status-success'
                    )}
                  >
                    {formatCurrency(snapshot.overview.netSavings, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Savings rate:{' '}
                    {snapshot.overview.savingsRatePct !== null
                      ? `${formatSensitiveNumber(snapshot.overview.savingsRatePct, 1)}%`
                      : 'Unavailable (0 income)'}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Filtered Portfolio</p>
                  <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-ink">
                    {formatCurrency(snapshot.overview.investmentValue, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Unrealized P/L:{' '}
                    {formatCurrency(snapshot.investments.unrealizedPnl, baseCurrency, numberFormat)}
                  </p>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-medium text-ink-muted">Consolidated Net Worth</p>
                  <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-ink">
                    {formatCurrency(snapshot.overview.netWorth, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {snapshot.netWorth.cashSharePct !== null
                      ? `${formatSensitiveNumber(snapshot.netWorth.cashSharePct, 0)}% Cash · ${
                          formatSensitiveNumber(snapshot.netWorth.investmentSharePct ?? 0, 0)
                        }% Inv`
                      : 'Assets only'}
                  </p>
                </Card>
              </div>

              {/* 2. Income & Expense Analysis */}
              {showSection('cashflow') ? (
                <div className="space-y-6">
                  {/* Income Section */}
                  <Card className="p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-status-success" />
                        <h2 className="text-base font-semibold text-ink">Income Analysis</h2>
                      </div>
                      <span className="text-xs text-ink-muted">
                        Strictly posted income transactions · Excludes internal transfers
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Total Income</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(snapshot.income.totalIncome, baseCurrency, numberFormat)}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          {snapshot.income.transactionCount} income record(s)
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Average Monthly Income</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.income.averageMonthlyIncome,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Across {snapshot.income.monthCount} month(s)
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Period Growth vs. Prior</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {snapshot.income.incomeChangePct !== null
                            ? `${formatSensitiveSignedNumber(snapshot.income.incomeChangePct, 1)}%`
                            : '—'}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          {snapshot.income.incomeChangeAbs !== null
                            ? `${snapshot.income.incomeChangeAbs >= 0 ? '+' : ''}${formatCurrency(
                                snapshot.income.incomeChangeAbs,
                                baseCurrency,
                                numberFormat
                              )}`
                            : 'No prior baseline'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Largest Income Entry</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {snapshot.income.largestTransaction
                            ? formatCurrency(
                                snapshot.income.largestTransaction.convertedAmount,
                                baseCurrency,
                                numberFormat
                              )
                            : '—'}
                        </p>
                        <p className="mt-0.5 truncate text-ink-muted">
                          {snapshot.income.largestTransaction
                            ? `${snapshot.income.largestTransaction.description} · ${formatDisplayDate(
                                snapshot.income.largestTransaction.date,
                                dateFormat
                              )}`
                            : 'None recorded'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
                      <div className="lg:col-span-2">
                        <IncomeTrendChart
                          points={snapshot.income.trendSeries}
                          currency={baseCurrency}
                          numberFormat={numberFormat}
                        />
                      </div>
                      <div className="space-y-4 text-xs">
                        <div>
                          <p className="font-semibold text-ink">Income by Category</p>
                          {snapshot.income.byCategory.length === 0 ? (
                            <p className="mt-1 text-ink-muted">No category data.</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {snapshot.income.byCategory.slice(0, 5).map((c) => (
                                <li
                                  key={c.categoryId}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="truncate text-ink">{c.categoryName}</span>
                                  <span className="font-mono tabular-nums text-ink-muted">
                                    {formatCurrency(c.amount, baseCurrency, numberFormat)} (
                                    {formatSensitiveNumber(c.percentageOfTotal, 0)}%)
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="border-t border-line pt-3">
                          <p className="font-semibold text-ink">Income by Account</p>
                          {snapshot.income.byAccount.length === 0 ? (
                            <p className="mt-1 text-ink-muted">No account data.</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {snapshot.income.byAccount.slice(0, 5).map((a) => (
                                <li
                                  key={a.accountId}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="truncate text-ink">{a.accountName}</span>
                                  <span className="font-mono tabular-nums text-ink-muted">
                                    {formatCurrency(a.amount, baseCurrency, numberFormat)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Expense Analysis Section */}
                  <Card className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <TrendingDown className="h-4 w-4 text-status-danger" />
                          <h2 className="text-base font-semibold text-ink">Expense Analysis</h2>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          Click any category slice or row to inspect matching expenses in
                          Transactions.
                        </p>
                      </div>

                      <div className="inline-flex rounded-lg border border-line bg-surface-muted p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => setExpenseChartMode('monthly')}
                          className={cn(
                            'rounded-md px-3 py-1 font-medium',
                            expenseChartMode === 'monthly'
                              ? 'bg-surface text-ink shadow-xs'
                              : 'text-ink-muted hover:text-ink'
                          )}
                        >
                          Monthly Trend
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpenseChartMode('daily')}
                          className={cn(
                            'rounded-md px-3 py-1 font-medium',
                            expenseChartMode === 'daily'
                              ? 'bg-surface text-ink shadow-xs'
                              : 'text-ink-muted hover:text-ink'
                          )}
                        >
                          Daily Spending
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Category Breakdown (Donut)
                        </h3>
                        <ExpenseCategoryDonutChart
                          items={snapshot.expenses.byCategory}
                          currency={baseCurrency}
                          numberFormat={numberFormat}
                          onSelectCategory={navigateToExpenseCategory}
                        />
                      </div>
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          {expenseChartMode === 'monthly'
                            ? 'Monthly Expense Trend'
                            : 'Daily Spending Pattern'}
                        </h3>
                        <ExpenseTrendSeriesChart
                          points={
                            expenseChartMode === 'monthly'
                              ? snapshot.expenses.monthlySeries
                              : snapshot.expenses.dailySeries
                          }
                          currency={baseCurrency}
                          numberFormat={numberFormat}
                        />
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Top Expense Categories Comparison
                        </h3>
                        <ExpenseCategoryHorizontalChart
                          items={snapshot.expenses.byCategory}
                          currency={baseCurrency}
                          numberFormat={numberFormat}
                        />
                      </div>

                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Category Details &amp; Prior Comparison
                        </h3>
                        {snapshot.expenses.byCategory.length === 0 ? (
                          <p className="text-xs text-ink-muted">No expenses in period.</p>
                        ) : (
                          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                            {snapshot.expenses.byCategory.map((cat) => (
                              <button
                                key={cat.categoryId}
                                type="button"
                                onClick={() => navigateToExpenseCategory(cat.categoryId)}
                                className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-muted"
                              >
                                <div>
                                  <p className="font-semibold text-ink">{cat.categoryName}</p>
                                  <p className="text-[11px] text-ink-muted">
                                    {cat.transactionCount} tx · {formatSensitiveNumber(cat.percentageOfTotal, 1)}%
                                    {cat.percentageChange !== null
                                      ? ` · ${formatSensitiveSignedNumber(cat.percentageChange, 1)}% vs prior`
                                      : ''}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 font-mono font-semibold text-ink">
                                  <span>{formatCurrency(cat.amount, baseCurrency, numberFormat)}</span>
                                  <ArrowRight className="h-3.5 w-3.5 text-ink-muted" />
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              ) : null}

              {/* 3. Spending Behavior & Savings Analysis */}
              {showSection('behavior_savings') ? (
                <div className="space-y-6">
                  {/* Spending Behavior */}
                  <Card className="p-5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-brand-accent" />
                        <h2 className="text-base font-semibold text-ink">Spending Behavior</h2>
                      </div>
                      <span className="text-xs text-ink-muted">
                        Sample: {snapshot.spendingBehavior.sampleSize.expenseCount} expense(s)
                        across {snapshot.spendingBehavior.sampleSize.activeDayCount} active day(s)
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Average Daily Spending</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.spendingBehavior.averageDailySpending,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Over {snapshot.spendingBehavior.sampleSize.spanDays} calendar day(s)
                        </p>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Average Transaction Size</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.spendingBehavior.averageTransactionSize,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Most frequent:{' '}
                          {snapshot.spendingBehavior.mostFrequentCategory
                            ? `${snapshot.spendingBehavior.mostFrequentCategory.categoryName} (${snapshot.spendingBehavior.mostFrequentCategory.transactionCount}x)`
                            : '—'}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Highest Spending Day</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {snapshot.spendingBehavior.highestSpendingDay
                            ? formatCurrency(
                                snapshot.spendingBehavior.highestSpendingDay.amount,
                                baseCurrency,
                                numberFormat
                              )
                            : '—'}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          {snapshot.spendingBehavior.highestSpendingDay
                            ? formatDisplayDate(
                                snapshot.spendingBehavior.highestSpendingDay.date,
                                dateFormat
                              )
                            : 'No expenses recorded'}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Category Concentration</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {snapshot.spendingBehavior.topCategoryConcentrationPct !== null
                            ? `${formatSensitiveNumber(snapshot.spendingBehavior.topCategoryConcentrationPct, 1)}%`
                            : '—'}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Top 3 share:{' '}
                          {snapshot.spendingBehavior.top3CategoryConcentrationPct !== null
                            ? `${formatSensitiveNumber(snapshot.spendingBehavior.top3CategoryConcentrationPct, 1)}%`
                            : '—'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-line bg-surface-muted/30 p-4 text-xs">
                        <p className="font-semibold text-ink">Weekday vs. Weekend Spending</p>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-ink-muted">
                              Weekdays ({snapshot.spendingBehavior.weekdayVsWeekend.weekdayCount}{' '}
                              tx)
                            </p>
                            <p className="mt-1 font-mono text-sm font-semibold text-ink">
                              {formatCurrency(
                                snapshot.spendingBehavior.weekdayVsWeekend.weekdayTotal,
                                baseCurrency,
                                numberFormat
                              )}
                            </p>
                            <p className="text-[11px] text-ink-muted">
                              {formatSensitiveNumber(snapshot.spendingBehavior.weekdayVsWeekend.weekdaySharePct, 1)}
                              % of spending
                            </p>
                          </div>
                          <div>
                            <p className="text-ink-muted">
                              Weekends ({snapshot.spendingBehavior.weekdayVsWeekend.weekendCount}{' '}
                              tx)
                            </p>
                            <p className="mt-1 font-mono text-sm font-semibold text-ink">
                              {formatCurrency(
                                snapshot.spendingBehavior.weekdayVsWeekend.weekendTotal,
                                baseCurrency,
                                numberFormat
                              )}
                            </p>
                            <p className="text-[11px] text-ink-muted">
                              {formatSensitiveNumber(snapshot.spendingBehavior.weekdayVsWeekend.weekendSharePct, 1)}
                              % of spending
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-muted/30 p-4 text-xs">
                        <p className="font-semibold text-ink">Recurring / Subscription Patterns</p>
                        {snapshot.spendingBehavior.recurringCandidates.length === 0 ? (
                          <p className="mt-2 text-ink-muted">
                            No repeated multi-month recurring expenses detected inside this period.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {snapshot.spendingBehavior.recurringCandidates.map((r) => (
                              <li
                                key={r.merchantOrDescription}
                                className="flex items-center justify-between gap-2"
                              >
                                <span className="truncate text-ink">
                                  {r.merchantOrDescription}{' '}
                                  <span className="text-ink-muted">
                                    ({r.distinctMonths} mo · {r.categoryName})
                                  </span>
                                </span>
                                <span className="font-mono font-medium text-ink">
                                  ~{formatCurrency(r.averageAmount, r.currency, numberFormat)}/tx
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </Card>

                  {/* Savings Analysis */}
                  <Card className="p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <PiggyBank className="h-4 w-4 text-brand-accent" />
                        <h2 className="text-base font-semibold text-ink">Savings Analysis</h2>
                      </div>
                      {snapshot.savings.incompletePeriodIncluded ? (
                        <span className="text-[11px] text-ink-muted">
                          Includes current in-progress month
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Total Net Savings</p>
                        <p
                          className={cn(
                            'mt-1 font-mono text-base font-bold',
                            snapshot.savings.hasNegativeSavings
                              ? 'text-status-danger'
                              : 'text-status-success'
                          )}
                        >
                          {formatCurrency(snapshot.savings.totalSavings, baseCurrency, numberFormat)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Savings Rate</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {snapshot.savings.savingsRatePct !== null
                            ? `${formatSensitiveNumber(snapshot.savings.savingsRatePct, 1)}%`
                            : 'Unavailable (0 income)'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Expense-to-Income Ratio</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {snapshot.savings.expenseToIncomeRatioPct !== null
                            ? `${formatSensitiveNumber(snapshot.savings.expenseToIncomeRatioPct, 1)}%`
                            : 'Unavailable (0 income)'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Average Monthly Savings</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.savings.averageMonthlySavings,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5">
                      <SavingsMonthlyTrendChart
                        points={snapshot.savings.monthlyTrend}
                        currency={baseCurrency}
                        numberFormat={numberFormat}
                      />
                    </div>
                  </Card>
                </div>
              ) : null}

              {/* 4. Investment Analytics & Net Worth Analysis */}
              {showSection('investments_networth') ? (
                <div className="space-y-6">
                  {/* Investment Analytics */}
                  <Card className="p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-brand-primary" />
                        <h2 className="text-base font-semibold text-ink">
                          Investment Analytics
                          {snapshot.investments.isFilteredSubset ? ' (Filtered Subset)' : ''}
                        </h2>
                      </div>
                      <Link
                        href="/investments"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
                      >
                        Manage Portfolio <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Filtered Investment Value</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.investments.totalInvestmentValue,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Holdings:{' '}
                          {formatCurrency(
                            snapshot.investments.holdingsMarketValue,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Remaining Cost Basis</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.investments.remainingCostBasis,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Period Net Contrib:{' '}
                          {formatCurrency(
                            snapshot.investments.periodNetContributions,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Unrealized P/L</p>
                        <p
                          className={cn(
                            'mt-1 font-mono text-base font-bold',
                            snapshot.investments.unrealizedPnl >= 0
                              ? 'text-status-success'
                              : 'text-status-danger'
                          )}
                        >
                          {snapshot.investments.unrealizedPnl >= 0 ? '+' : ''}
                          {formatCurrency(
                            snapshot.investments.unrealizedPnl,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          {snapshot.investments.unrealizedPnlPct !== null
                            ? `${formatSensitiveSignedNumber(snapshot.investments.unrealizedPnlPct, 1)}% on cost basis`
                            : 'No cost basis'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Realized P/L &amp; Income</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.investments.realizedPnl +
                              snapshot.investments.dividendAndInterestTotal,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                        <p className="mt-0.5 text-ink-muted">
                          Fees: {formatCurrency(snapshot.investments.totalFees, baseCurrency, numberFormat)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Investment Value &amp; Snapshot History
                        </h3>
                        <InvestmentValueHistoryChart
                          points={snapshot.investments.valueTrend}
                          currency={baseCurrency}
                          numberFormat={numberFormat}
                          dateFormat={dateFormat}
                        />
                      </div>
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Contribution &amp; Trading Activity History
                        </h3>
                        <InvestmentActivityHistoryChart
                          points={snapshot.investments.activityTrend}
                          currency={baseCurrency}
                          numberFormat={numberFormat}
                        />
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Asset Class Performance
                        </h3>
                        {snapshot.investments.byAssetClass.length === 0 ? (
                          <p className="text-xs text-ink-muted">No matching asset classes.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-line text-ink-muted">
                                  <th className="py-2 pr-3 font-medium">Asset Class</th>
                                  <th className="py-2 pr-3 font-medium">Market Value</th>
                                  <th className="py-2 pr-3 font-medium">Weight</th>
                                  <th className="py-2 font-medium">Unrealized P/L</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {snapshot.investments.byAssetClass.map((ac) => (
                                  <tr key={ac.assetClassId}>
                                    <td className="py-2 pr-3 font-medium text-ink">
                                      {ac.assetClassName}
                                    </td>
                                    <td className="py-2 pr-3 font-mono tabular-nums text-ink">
                                      {formatCurrency(ac.marketValue, baseCurrency, numberFormat)}
                                    </td>
                                    <td className="py-2 pr-3 font-mono tabular-nums text-ink-muted">
                                      {formatSensitiveNumber(ac.allocationPct, 1)}%
                                    </td>
                                    <td
                                      className={cn(
                                        'py-2 font-mono tabular-nums',
                                        ac.unrealizedPnl >= 0
                                          ? 'text-status-success'
                                          : 'text-status-danger'
                                      )}
                                    >
                                      {ac.unrealizedPnl >= 0 ? '+' : ''}
                                      {formatCurrency(ac.unrealizedPnl, baseCurrency, numberFormat)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">
                          Platform Performance
                        </h3>
                        {snapshot.investments.byPlatform.length === 0 ? (
                          <p className="text-xs text-ink-muted">No matching platforms.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-line text-ink-muted">
                                  <th className="py-2 pr-3 font-medium">Platform</th>
                                  <th className="py-2 pr-3 font-medium">Total Value</th>
                                  <th className="py-2 pr-3 font-medium">Share</th>
                                  <th className="py-2 font-medium">Total P/L</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {snapshot.investments.byPlatform.map((p) => (
                                  <tr key={p.platformId}>
                                    <td className="py-2 pr-3 font-medium text-ink">
                                      {p.platformName}
                                    </td>
                                    <td className="py-2 pr-3 font-mono tabular-nums text-ink">
                                      {formatCurrency(
                                        p.totalPlatformValue,
                                        baseCurrency,
                                        numberFormat
                                      )}
                                    </td>
                                    <td className="py-2 pr-3 font-mono tabular-nums text-ink-muted">
                                      {formatSensitiveNumber(p.allocationPct, 1)}%
                                    </td>
                                    <td
                                      className={cn(
                                        'py-2 font-mono tabular-nums',
                                        p.totalPnl >= 0
                                          ? 'text-status-success'
                                          : 'text-status-danger'
                                      )}
                                    >
                                      {p.totalPnl >= 0 ? '+' : ''}
                                      {formatCurrency(p.totalPnl, baseCurrency, numberFormat)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="mt-4 flex items-start gap-1.5 text-[11px] text-ink-muted">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {snapshot.investments.returnMethodologyNote}
                    </p>
                  </Card>

                  {/* Net Worth Analysis */}
                  <Card className="p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 text-brand-primary" />
                        <h2 className="text-base font-semibold text-ink">Net Worth Analysis</h2>
                      </div>
                      <span className="text-xs text-ink-muted">
                        Assets only (Liabilities module not yet active)
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Consolidated Net Worth</p>
                        <p className="mt-1 font-mono text-base font-bold text-ink">
                          {formatCurrency(
                            snapshot.netWorth.currentNetWorth,
                            baseCurrency,
                            numberFormat
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Cash vs. Investment Composition</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-ink">
                          {formatCurrency(
                            snapshot.netWorth.availableCash,
                            baseCurrency,
                            numberFormat
                          )}{' '}
                          Cash ·{' '}
                          {formatCurrency(
                            snapshot.netWorth.investmentValue,
                            baseCurrency,
                            numberFormat
                          )}{' '}
                          Inv
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs">
                        <p className="text-ink-muted">Period Net Worth Change</p>
                        <p
                          className={cn(
                            'mt-1 font-mono text-base font-bold',
                            (snapshot.netWorth.periodGrowthAbs ?? 0) >= 0
                              ? 'text-status-success'
                              : 'text-status-danger'
                          )}
                        >
                          {snapshot.netWorth.periodGrowthAbs !== null
                            ? `${snapshot.netWorth.periodGrowthAbs >= 0 ? '+' : ''}${formatCurrency(
                                snapshot.netWorth.periodGrowthAbs,
                                baseCurrency,
                                numberFormat
                              )}`
                            : 'Insufficient checkpoints'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
                      <div className="lg:col-span-2">
                        <NetWorthAnalyticsTrendChart
                          trend={snapshot.netWorth.trend}
                          numberFormat={numberFormat}
                          dateFormat={dateFormat}
                        />
                      </div>
                      <div>
                        <h3 className="mb-2 text-xs font-semibold text-ink">Asset Breakdown</h3>
                        {snapshot.netWorth.assetBreakdown.length === 0 ? (
                          <p className="text-xs text-ink-muted">No asset balances recorded.</p>
                        ) : (
                          <div className="space-y-2 text-xs">
                            {snapshot.netWorth.assetBreakdown.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-lg border border-line bg-surface-muted/40 p-2.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-ink">{item.name}</span>
                                  <span className="font-mono font-semibold text-ink">
                                    {formatCurrency(item.value, baseCurrency, numberFormat)}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-[11px] text-ink-muted">
                                  {formatSensitiveNumber(item.percentage, 1)}% · {item.detail}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              ) : null}

              {/* 5. Financial Health Indicators & Automated Insights */}
              {showSection('health_insights') ? (
                <div className="space-y-6">
                  <Card className="p-5">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-brand-accent" />
                      <h2 className="text-base font-semibold text-ink">
                        Financial Health Indicators
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Each indicator exposes its exact mathematical formula and reporting window
                      computed directly from your local ledger.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {snapshot.healthIndicators.map((ind) => {
                        const meta = healthStatusStyles(ind.status);
                        return (
                          <div
                            key={ind.id}
                            className="flex flex-col justify-between rounded-xl border border-line bg-surface-muted/30 p-4 text-xs"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-ink">{ind.label}</span>
                                <span
                                  className={cn(
                                    'rounded-md border px-2 py-0.5 text-[11px] font-medium',
                                    meta.badge
                                  )}
                                >
                                  {meta.label}
                                </span>
                              </div>
                              <p className="mt-2 font-mono text-lg font-bold text-ink">
                                {formatPrivacySensitiveText(ind.formattedValue)}
                              </p>
                              <p className="mt-1 text-ink-muted">
                                {formatPrivacySensitiveText(ind.dataSummary)}
                              </p>
                            </div>
                            <div className="mt-3 border-t border-line pt-2 text-[11px] text-ink-muted">
                              <p>Formula: {ind.formula}</p>
                              <p>Period: {ind.reportingPeriod}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-status-warning" />
                      <h2 className="text-base font-semibold text-ink">
                        Local Financial Insights
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Deterministic observations derived strictly from verified local records. No
                      speculative investment advice or external AI processing.
                    </p>

                    {snapshot.insights.length === 0 ? (
                      <div className="mt-4 rounded-lg border border-dashed border-line bg-surface-muted/40 p-4 text-xs text-ink-muted">
                        Insufficient data in the active filter window to produce verified pattern
                        observations yet.
                      </div>
                    ) : (
                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {snapshot.insights.map((ins) => (
                          <div
                            key={ins.id}
                            className={cn(
                              'rounded-lg border p-3.5 text-xs',
                              ins.tone === 'warning'
                                ? 'border-status-warning/30 bg-status-warning/10'
                                : ins.tone === 'positive'
                                  ? 'border-status-success/30 bg-status-success/10'
                                  : 'border-line bg-surface-muted/40'
                            )}
                          >
                            <div className="flex items-start gap-2">
                              {ins.tone === 'positive' ? (
                                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-status-success" />
                              ) : ins.tone === 'warning' ? (
                                <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
                              ) : (
                                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" />
                              )}
                              <div>
                                <p className="font-semibold text-ink">
                                  {formatPrivacySensitiveText(ins.title)}
                                </p>
                                <p className="mt-1 leading-relaxed text-ink-muted">
                                  {formatPrivacySensitiveText(ins.description)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              ) : null}
            </>
          )}
        </div>
      </PageContainer>
    </AppLayout>
  );
}
