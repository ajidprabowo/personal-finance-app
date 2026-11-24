'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Landmark,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { TransactionDetailModal } from '@/components/transactions/transaction-detail-modal';
import { TransactionFormModal } from '@/components/transactions/transaction-form-modal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import {
  formatDisplayDate,
  getPeriodDateRange,
  type ReportingPeriodPreset,
} from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  getAccountBalancesSnapshot,
  type AccountBalancesSnapshot,
} from '@/services/account-balance.service';
import {
  getFinancialSummaryForPeriod,
  type FinancialSummarySnapshot,
} from '@/services/financial-summary.service';
import { listUserAccounts, listUserCategoriesWithCounts } from '@/services/settings.service';
import {
  deleteTransaction,
  listTransactionsFiltered,
  type EnrichedTransactionItem,
  type PaginatedTransactionsResult,
} from '@/services/transaction.service';
import type {
  Account,
  AccountType,
  Category,
  Subcategory,
  Transaction,
  TransactionType,
} from '@/types/entities';

const PERIOD_PRESETS: Array<{ value: ReportingPeriodPreset; label: string }> = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

const ACCOUNT_TYPE_SHORT: Record<AccountType, string> = {
  bank: 'Bank',
  cash: 'Cash',
  ewallet: 'E-Wallet',
  investment_pool: 'Inv. Pool',
  investment_cash: 'Platform Cash',
  credit_card: 'Card',
  other: 'Other',
};

export function TransactionsView() {
  const searchParams = useSearchParams();
  const { preferences } = useBootstrap();
  const { t, periodLabel } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;
  const baseCurrency = preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const numberFormat = preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  // Reporting period & filters (supports deep-link query params from Dashboard drill-downs)
  const [periodPreset, setPeriodPreset] = useState<ReportingPeriodPreset>(() => {
    const startParam = searchParams.get('startDate');
    const endParam = searchParams.get('endDate');
    if (startParam || endParam) return 'custom';
    const presetParam = searchParams.get('preset') as ReportingPeriodPreset | null;
    if (
      presetParam &&
      [
        'this_month',
        'last_month',
        'last_3_months',
        'last_6_months',
        'this_year',
        'last_year',
        'all_time',
        'custom',
      ].includes(presetParam)
    ) {
      return presetParam;
    }
    return 'this_month';
  });
  const [customStart, setCustomStart] = useState<string>(
    () => searchParams.get('startDate') ?? ''
  );
  const [customEnd, setCustomEnd] = useState<string>(
    () => searchParams.get('endDate') ?? ''
  );
  const [search, setSearch] = useState<string>(() => searchParams.get('search') ?? '');
  const [typeFilter, setTypeFilter] = useState<TransactionType | 'all'>(() => {
    const t = searchParams.get('type');
    return t === 'income' || t === 'expense' || t === 'transfer' ? t : 'all';
  });
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => searchParams.get('categoryId') ?? 'all'
  );
  const [accountFilter, setAccountFilter] = useState<string>(
    () => searchParams.get('accountId') ?? 'all'
  );
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [reloadTick, setReloadTick] = useState<number>(0);

  // Data state
  const [loading, setLoading] = useState<boolean>(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [balances, setBalances] = useState<AccountBalancesSnapshot | null>(null);
  const [summary, setSummary] = useState<FinancialSummarySnapshot | null>(null);
  const [ledger, setLedger] = useState<PaginatedTransactionsResult>({
    items: [],
    totalCount: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });

  // UI state
  const [showBalancesPanel, setShowBalancesPanel] = useState<boolean>(true);
  const [showArchivedAccounts, setShowArchivedAccounts] = useState<boolean>(false);
  const [formModalOpen, setFormModalOpen] = useState<boolean>(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [detailItem, setDetailItem] = useState<EnrichedTransactionItem | null>(null);

  const activeDateRange = useMemo(
    () =>
      getPeriodDateRange(periodPreset, {
        timezone,
        customStart: customStart || null,
        customEnd: customEnd || null,
      }),
    [periodPreset, timezone, customStart, customEnd]
  );

  const fetchAllTransactionData = useCallback(async () => {
    const [accountRows, categoryData, balanceSnapshot, summarySnapshot, ledgerResult] =
      await Promise.all([
        listUserAccounts(),
        listUserCategoriesWithCounts(),
        getAccountBalancesSnapshot({ recordOrigin: 'user' }),
        getFinancialSummaryForPeriod({
          preset: periodPreset,
          customStart: customStart || null,
          customEnd: customEnd || null,
          timezone,
          primaryCurrency: baseCurrency,
          recordOrigin: 'user',
        }),
        listTransactionsFiltered({
          recordOrigin: 'user',
          search,
          type: typeFilter,
          categoryId: categoryFilter,
          accountId: accountFilter,
          startDate: activeDateRange.startDate,
          endDate: activeDateRange.endDate,
          sortOrder,
          page,
          pageSize,
        }),
      ]);

    return {
      accountRows,
      categoryRows: categoryData.categories,
      subcategoryRows: categoryData.subcategories,
      balanceSnapshot,
      summarySnapshot,
      ledgerResult,
    };
  }, [
    periodPreset,
    customStart,
    customEnd,
    timezone,
    baseCurrency,
    search,
    typeFilter,
    categoryFilter,
    accountFilter,
    activeDateRange.startDate,
    activeDateRange.endDate,
    sortOrder,
    page,
    pageSize,
  ]);

  useEffect(() => {
    let active = true;
    fetchAllTransactionData()
      .then((data) => {
        if (!active) return;
        setAccounts(data.accountRows);
        setCategories(data.categoryRows);
        setSubcategories(data.subcategoryRows);
        setBalances(data.balanceSnapshot);
        setSummary(data.summarySnapshot);
        setLedger(data.ledgerResult);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load transaction data', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchAllTransactionData, reloadTick, notifyError]);

  const triggerReload = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  const activeAccounts = useMemo(
    () => accounts.filter((acc) => !acc.isArchived),
    [accounts]
  );

  const archivedAccountCount = useMemo(
    () => accounts.filter((acc) => acc.isArchived).length,
    [accounts]
  );

  const visibleBalanceItems = useMemo(() => {
    if (!balances) return [];
    return showArchivedAccounts
      ? balances.items
      : balances.items.filter((item) => !item.account.isArchived);
  }, [balances, showArchivedAccounts]);

  const currencySummaryEntries = useMemo(() => {
    if (!summary) return [];
    return Object.values(summary.byCurrency);
  }, [summary]);

  const currencyBalanceTotals = useMemo(() => {
    if (!balances) return [];
    return Object.values(balances.totalsByCurrency);
  }, [balances]);

  const hasActiveFilters =
    search.trim() !== '' ||
    typeFilter !== 'all' ||
    categoryFilter !== 'all' ||
    accountFilter !== 'all' ||
    sortOrder !== 'newest';

  const handleResetFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setCategoryFilter('all');
    setAccountFilter('all');
    setSortOrder('newest');
    setPage(1);
  };

  const handleOpenCreate = () => {
    setEditingTx(null);
    setFormModalOpen(true);
  };

  const handleOpenEdit = (item: EnrichedTransactionItem) => {
    setEditingTx(item.transaction);
    setFormModalOpen(true);
  };

  const handleQuickDelete = async (
    e: React.MouseEvent,
    item: EnrichedTransactionItem
  ) => {
    e.stopPropagation();
    const tx = item.transaction;
    const isTransfer = tx.type === 'transfer';
    const approved = await confirm({
      title: isTransfer ? 'Delete Internal Transfer' : 'Delete Transaction',
      description: isTransfer
        ? `Delete transfer "${tx.description}" (${formatCurrency(tx.amount, tx.currency, numberFormat)})? Both source and destination balances will be restored.`
        : `Delete "${tx.description}" (${formatCurrency(tx.amount, tx.currency, numberFormat)})? Account balance will be updated automatically.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!approved) return;

    try {
      await deleteTransaction(tx.id, { recordOrigin: 'user' });
      notifySuccess(
        isTransfer ? 'Transfer deleted' : 'Transaction deleted',
        'Account balances and summaries updated.'
      );
      triggerReload();
    } catch (error) {
      notifyError('Failed to delete transaction', error);
    }
  };

  const activeRangeLabel = useMemo(() => {
    if (periodPreset === 'all_time') return 'All recorded dates';
    const startLabel = activeDateRange.startDate
      ? formatDisplayDate(activeDateRange.startDate, dateFormat)
      : 'Start';
    const endLabel = activeDateRange.endDate
      ? formatDisplayDate(activeDateRange.endDate, dateFormat)
      : 'Today';
    return `${startLabel} – ${endLabel}`;
  }, [periodPreset, activeDateRange.startDate, activeDateRange.endDate, dateFormat]);

  const showingFrom = ledger.totalCount === 0 ? 0 : (ledger.page - 1) * ledger.pageSize + 1;
  const showingTo = Math.min(ledger.page * ledger.pageSize, ledger.totalCount);

  return (
    <AppLayout>
      <PageContainer>
        <PageHeader
          title={t('page.transactions.title')}
          description={t('page.transactions.description')}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/transactions/import">
                <Button variant="outline" size="sm">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Import Gmail</span>
                </Button>
              </Link>
              <Link href="/profile#accounts">
                <Button variant="outline" size="sm">
                  <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Accounts</span>
                </Button>
              </Link>
              <Button size="sm" onClick={handleOpenCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Add Transaction</span>
              </Button>
            </div>
          }
        />

        <div className="space-y-6">
          {/* Period Selector + Summary KPI Cards */}
          <section aria-label="Financial summary" className="space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-1.5">
                {PERIOD_PRESETS.map((preset) => {
                  const selected = periodPreset === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        setPeriodPreset(preset.value);
                        setPage(1);
                      }}
                      className={cn(
                        'inline-flex h-8 items-center whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                        selected
                          ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                          : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
                      )}
                    >
                      {periodLabel(preset.value)}
                    </button>
                  );
                })}
              </div>
              <p className="font-mono text-xs tabular-nums text-ink-muted">{activeRangeLabel}</p>
            </div>

            {periodPreset === 'custom' ? (
              <Card padding="sm" className="bg-surface-muted/60">
                <div className="grid gap-3 sm:grid-cols-2 md:max-w-md">
                  <div>
                    <label
                      htmlFor="custom-start-date"
                      className="mb-1 block text-xs font-medium text-ink"
                    >
                      Start Date
                    </label>
                    <input
                      id="custom-start-date"
                      type="date"
                      value={customStart}
                      onChange={(e) => {
                        setCustomStart(e.target.value);
                        setPage(1);
                      }}
                      className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:border-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="custom-end-date"
                      className="mb-1 block text-xs font-medium text-ink"
                    >
                      End Date
                    </label>
                    <input
                      id="custom-end-date"
                      type="date"
                      value={customEnd}
                      onChange={(e) => {
                        setCustomEnd(e.target.value);
                        setPage(1);
                      }}
                      className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:border-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    />
                  </div>
                </div>
              </Card>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card padding="md">
                <p className="text-xs font-medium text-ink-muted">Total Income</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-status-success">
                  {formatCurrency(
                    summary?.totalIncome ?? 0,
                    summary?.primaryCurrency ?? baseCurrency,
                    numberFormat
                  )}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Excludes internal transfers
                </p>
              </Card>

              <Card padding="md">
                <p className="text-xs font-medium text-ink-muted">Total Expenses</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-status-danger">
                  {formatCurrency(
                    summary?.totalExpenses ?? 0,
                    summary?.primaryCurrency ?? baseCurrency,
                    numberFormat
                  )}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Excludes internal transfers
                </p>
              </Card>

              <Card padding="md">
                <p className="text-xs font-medium text-ink-muted">Net Cash Flow</p>
                <p
                  className={cn(
                    'mt-2 text-2xl font-semibold tabular-nums',
                    (summary?.netCashFlow ?? 0) > 0
                      ? 'text-status-success'
                      : (summary?.netCashFlow ?? 0) < 0
                        ? 'text-status-danger'
                        : 'text-ink'
                  )}
                >
                  {(summary?.netCashFlow ?? 0) > 0 ? '+' : ''}
                  {formatCurrency(
                    summary?.netCashFlow ?? 0,
                    summary?.primaryCurrency ?? baseCurrency,
                    numberFormat
                  )}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Income minus expenses
                </p>
              </Card>

              <Card padding="md">
                <p className="text-xs font-medium text-ink-muted">Transactions</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                  {summary?.transactionCount ?? 0}
                </p>
                <p className="mt-1 text-xs tabular-nums text-ink-muted">
                  {summary?.incomeCount ?? 0} income · {summary?.expenseCount ?? 0} expense ·{' '}
                  {summary?.transferCount ?? 0} transfer
                </p>
              </Card>
            </div>

            {currencySummaryEntries.length > 1 ? (
              <Card padding="sm" className="bg-surface-muted/60">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                  <span className="font-semibold text-ink">Currency Breakdown:</span>
                  {currencySummaryEntries.map((bucket) => (
                    <div key={bucket.currency} className="flex items-center gap-2 tabular-nums">
                      <span className="font-mono font-semibold text-ink">{bucket.currency}</span>
                      <span className="text-status-success">
                        +{formatCurrency(bucket.totalIncome, bucket.currency, numberFormat)}
                      </span>
                      <span className="text-status-danger">
                        -{formatCurrency(bucket.totalExpenses, bucket.currency, numberFormat)}
                      </span>
                      <span className="text-ink-muted">
                        (Net {formatCurrency(bucket.netCashFlow, bucket.currency, numberFormat)})
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

          {/* Account Balances Strip */}
          <section aria-label="Account balances">
            <Card padding="none">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-sm font-semibold text-ink">Account Balances</h2>
                  {currencyBalanceTotals.map((tot) => (
                    <span
                      key={tot.currency}
                      className="rounded border border-line bg-surface-muted px-2 py-0.5 text-xs font-medium tabular-nums text-ink"
                    >
                      Total {tot.currency}:{' '}
                      {formatCurrency(tot.totalAccountBalance, tot.currency, numberFormat)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {archivedAccountCount > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowArchivedAccounts((v) => !v)}
                    >
                      {showArchivedAccounts
                        ? 'Hide Archived'
                        : `Show Archived (${archivedAccountCount})`}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowBalancesPanel((v) => !v)}
                  >
                    {showBalancesPanel ? (
                      <>
                        <span>Collapse</span>
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        <span>Expand</span>
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {showBalancesPanel ? (
                visibleBalanceItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-between gap-3 px-5 py-6 text-center sm:flex-row sm:text-left">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        Create your first account in Settings
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Add a Bank Account, Cash wallet, or E-Wallet with an opening balance to
                        track transactions.
                      </p>
                    </div>
                    <Link href="/profile#accounts">
                      <Button variant="outline" size="sm">
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Manage Accounts</span>
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                    {visibleBalanceItems.map((item) => {
                      const acc = item.account;
                      return (
                        <div key={acc.id} className="bg-surface px-5 py-3.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-ink">{acc.name}</p>
                              <p className="mt-0.5 text-xs text-ink-muted">
                                {ACCOUNT_TYPE_SHORT[acc.type] ?? acc.type} ·{' '}
                                <span className="font-mono">{acc.currency}</span>
                                {acc.isArchived ? ' · Archived' : ''}
                              </p>
                            </div>
                            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                              {formatCurrency(item.currentBalance, acc.currency, numberFormat)}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-ink-muted">
                            <span>
                              Opening:{' '}
                              {formatCurrency(item.openingBalance, acc.currency, numberFormat)}
                            </span>
                            <span>
                              {item.excludedFromConsolidatedTotal
                                ? 'Mirrored in Pool'
                                : `${item.transactionCount} tx`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : null}
            </Card>
          </section>

          {/* Search, Filter & Transaction Ledger */}
          <section aria-label="Transaction ledger" className="space-y-4">
            <Card padding="sm">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="relative md:col-span-4">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    aria-label="Search transactions"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search description or notes..."
                    className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted/70 transition-colors focus-visible:border-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  />
                </div>

                <div className="md:col-span-2">
                  <Select
                    aria-label="Filter by type"
                    value={typeFilter}
                    onChange={(e) => {
                      setTypeFilter(e.target.value as TransactionType | 'all');
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: 'All Types' },
                      { value: 'income', label: 'Income' },
                      { value: 'expense', label: 'Expense' },
                      { value: 'transfer', label: 'Transfer' },
                    ]}
                  />
                </div>

                <div className="md:col-span-2">
                  <Select
                    aria-label="Filter by category"
                    value={categoryFilter}
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: 'All Categories' },
                      ...categories.map((c) => ({
                        value: c.id,
                        label: `${c.name}${c.isArchived ? ' (Archived)' : ''}`,
                      })),
                    ]}
                  />
                </div>

                <div className="md:col-span-2">
                  <Select
                    aria-label="Filter by account"
                    value={accountFilter}
                    onChange={(e) => {
                      setAccountFilter(e.target.value);
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: 'All Accounts' },
                      ...accounts.map((a) => ({
                        value: a.id,
                        label: `${a.name}${a.isArchived ? ' (Archived)' : ''}`,
                      })),
                    ]}
                  />
                </div>

                <div className="md:col-span-2">
                  <Select
                    aria-label="Sort transactions"
                    value={sortOrder}
                    onChange={(e) => {
                      setSortOrder(e.target.value as 'newest' | 'oldest');
                      setPage(1);
                    }}
                    options={[
                      { value: 'newest', label: 'Newest First' },
                      { value: 'oldest', label: 'Oldest First' },
                    ]}
                  />
                </div>
              </div>

              {hasActiveFilters ? (
                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs">
                  <span className="text-ink-muted">
                    Showing filtered results ({ledger.totalCount} match
                    {ledger.totalCount === 1 ? '' : 'es'})
                  </span>
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1.5 font-medium text-brand-secondary hover:underline"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reset filters</span>
                  </button>
                </div>
              ) : null}
            </Card>

            {loading ? (
              <Card padding="lg">
                <div className="py-8 text-center text-sm text-ink-muted">
                  Loading local transaction ledger...
                </div>
              </Card>
            ) : accounts.length === 0 ? (
              <EmptyState
                icon={<Landmark className="h-5 w-5" aria-hidden="true" />}
                title="Create your first account in Settings"
                description="Transactions require at least one local account (bank, cash, or e-wallet) to track opening and current balances."
                action={
                  <Link href="/profile#accounts">
                    <Button size="sm">Go to Account Settings</Button>
                  </Link>
                }
              />
            ) : ledger.items.length === 0 ? (
              <EmptyState
                icon={<ArrowLeftRight className="h-5 w-5" aria-hidden="true" />}
                title={
                  hasActiveFilters || periodPreset !== 'all_time'
                    ? 'No transactions match this period or filter'
                    : 'No transactions recorded yet'
                }
                description={
                  hasActiveFilters || periodPreset !== 'all_time'
                    ? 'Try switching the reporting period to All Time or resetting your active search and filters.'
                    : 'Record your first income, expense, or internal transfer to start tracking local balances.'
                }
                action={
                  hasActiveFilters || periodPreset !== 'all_time' ? (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {hasActiveFilters ? (
                        <Button variant="outline" size="sm" onClick={handleResetFilters}>
                          Reset Filters
                        </Button>
                      ) : null}
                      {periodPreset !== 'all_time' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPeriodPreset('all_time');
                            setPage(1);
                          }}
                        >
                          View All Time
                        </Button>
                      ) : null}
                      {activeAccounts.length > 0 ? (
                        <Button size="sm" onClick={handleOpenCreate}>
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          <span>Add Transaction</span>
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <Button size="sm" onClick={handleOpenCreate}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      <span>Add First Transaction</span>
                    </Button>
                  )
                }
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                {/* Desktop Table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted/70 text-xs font-semibold text-ink-muted">
                        <th className="px-5 py-3">Date</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Account</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {ledger.items.map((item) => {
                        const tx = item.transaction;
                        return (
                          <tr
                            key={tx.id}
                            onClick={() => setDetailItem(item)}
                            className="cursor-pointer transition-colors hover:bg-surface-muted/60"
                          >
                            <td className="whitespace-nowrap px-5 py-3.5 text-xs tabular-nums text-ink-muted">
                              {formatDisplayDate(tx.date, dateFormat)}
                            </td>
                            <td className="max-w-xs px-4 py-3.5">
                              <p className="truncate font-medium text-ink">{tx.description}</p>
                              {tx.notes ? (
                                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-muted">
                                  <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{tx.notes}</span>
                                </p>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-xs text-ink-muted">
                              {item.categoryName}
                              {item.subcategoryName ? ` · ${item.subcategoryName}` : ''}
                              {item.categoryArchived ? ' (Archived)' : ''}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-xs text-ink">
                              {tx.type === 'transfer'
                                ? `${item.accountName} → ${item.destinationAccountName ?? '—'}`
                                : item.accountName}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium capitalize',
                                  tx.type === 'income'
                                    ? 'bg-status-success/10 text-status-success'
                                    : tx.type === 'expense'
                                      ? 'bg-status-danger/10 text-status-danger'
                                      : 'bg-brand-secondary/10 text-brand-secondary'
                                )}
                              >
                                {tx.type === 'income' ? (
                                  <ArrowDownLeft className="h-3 w-3" aria-hidden="true" />
                                ) : tx.type === 'expense' ? (
                                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                                ) : (
                                  <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                                )}
                                {tx.type}
                              </span>
                            </td>
                            <td
                              className={cn(
                                'whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums',
                                tx.type === 'income'
                                  ? 'text-status-success'
                                  : tx.type === 'expense'
                                    ? 'text-status-danger'
                                    : 'text-ink'
                              )}
                            >
                              {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                              {formatCurrency(tx.amount, tx.currency, numberFormat)}
                            </td>
                            <td
                              className="whitespace-nowrap px-5 py-3.5 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center gap-1">
                                <IconButton
                                  label={`Edit ${tx.description}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenEdit(item)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton
                                  label={`Delete ${tx.description}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => void handleQuickDelete(e, item)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-status-danger" />
                                </IconButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile List */}
                <div className="divide-y divide-line md:hidden">
                  {ledger.items.map((item) => {
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
                        className="flex items-start justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{tx.description}</p>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {formatDisplayDate(tx.date, dateFormat)} · {item.categoryName}
                            {item.subcategoryName ? ` · ${item.subcategoryName}` : ''}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {tx.type === 'transfer'
                              ? `${item.accountName} → ${item.destinationAccountName ?? '—'}`
                              : item.accountName}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={cn(
                              'text-sm font-semibold tabular-nums',
                              tx.type === 'income'
                                ? 'text-status-success'
                                : tx.type === 'expense'
                                  ? 'text-status-danger'
                                  : 'text-ink'
                            )}
                          >
                            {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                            {formatCurrency(tx.amount, tx.currency, numberFormat)}
                          </p>
                          <p className="mt-0.5 text-[11px] capitalize text-ink-muted">{tx.type}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Bar */}
                <div className="flex flex-col items-center justify-between gap-3 border-t border-line bg-surface-muted/40 px-5 py-3 text-xs sm:flex-row">
                  <div className="flex items-center gap-3 text-ink-muted tabular-nums">
                    <span>
                      Showing {showingFrom}–{showingTo} of {ledger.totalCount}
                    </span>
                    <select
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    >
                      <option value={10}>10 / page</option>
                      <option value={20}>20 / page</option>
                      <option value={50}>50 / page</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={ledger.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Previous</span>
                    </Button>
                    <span className="px-2 font-mono text-xs tabular-nums text-ink-muted">
                      Page {ledger.page} of {ledger.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={ledger.page >= ledger.totalPages}
                      onClick={() => setPage((p) => Math.min(ledger.totalPages, p + 1))}
                    >
                      <span>Next</span>
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </section>
        </div>
      </PageContainer>

      <TransactionFormModal
        open={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingTx(null);
        }}
        onSaved={triggerReload}
        accounts={accounts}
        categories={categories}
        subcategories={subcategories}
        timezone={timezone}
        initialTransaction={editingTx}
      />

      <TransactionDetailModal
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onEdit={handleOpenEdit}
        onDeleted={triggerReload}
        numberFormat={numberFormat}
        dateFormat={dateFormat}
        timezone={timezone}
      />
    </AppLayout>
  );
}
