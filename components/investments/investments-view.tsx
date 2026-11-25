'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Coins,
  Layers,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  ActivityDetailAndEditModal,
  AssetClassModal,
  FxRateModal,
  HoldingModal,
  PlatformModal,
  PortfolioSnapshotModal,
  TradeOrIncomeModal,
  PoolTransferModal,
  ValuationUpdateModal,
  type PoolTransferMode,
  type TradeActivityMode,
} from '@/components/investments/investment-modals';
import {
  AssetAllocationChart,
  PerformanceHistoryChart,
  type AllocationChartRow,
} from '@/components/investments/investment-charts';
import { PlatformDetailPanel } from '@/components/investments/platform-detail-panel';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateRangeFilter } from '@/components/shared/date-range-filter';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency, formatNumericValue } from '@/lib/currency';
import { formatSensitiveSignedNumber } from '@/lib/privacy-mode';
import { formatDisplayDate, getPeriodDateRange, type ReportingPeriodPreset } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  deleteValuationSnapshot,
  ensureInvestmentPoolAccount,
  getInvestmentOverviewSnapshot,
  getInvestmentPoolSummary,
  getManualFxRates,
  getPortfolioPerformanceHistory,
  listAssetClassesWithUsage,
  listHoldingsWithMetrics,
  listInvestmentActivitiesFiltered,
  toggleAssetClassEnabled,
  type AssetClassWithUsage,
  type EnrichedInvestmentActivity,
  type HoldingEnriched,
  type InvestmentOverviewSnapshot,
  type InvestmentPoolSummary,
  type PlatformWithMetrics,
  type PortfolioPerformanceSnapshot,
} from '@/services/investment.service';
import { toggleInvestmentPlatformStatus } from '@/services/settings.service';
import type {
  AssetClass,
  InvestmentActivityType,
  ManualFxRateEntry,
} from '@/types/entities';

type InvestmentTabId =
  | 'overview'
  | 'platforms'
  | 'asset_classes'
  | 'holdings'
  | 'activity'
  | 'pool'
  | 'performance';

const TABS: Array<{ id: InvestmentTabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'asset_classes', label: 'Asset Classes' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'activity', label: 'Activity' },
  { id: 'pool', label: 'Investment Pool' },
  { id: 'performance', label: 'Performance' },
];

export function InvestmentsView() {
  const { preferences } = useBootstrap();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;
  const baseCurrency = preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const numberFormat = preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  const [activeTab, setActiveTab] = useState<InvestmentTabId>('overview');
  const [selectedCurrencyScope, setSelectedCurrencyScope] = useState<string>('ALL_CONVERTED');
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState<number>(0);

  // Core snapshots
  const [loading, setLoading] = useState<boolean>(true);
  const [overview, setOverview] = useState<InvestmentOverviewSnapshot | null>(null);
  const [poolSummary, setPoolSummary] = useState<InvestmentPoolSummary | null>(null);
  const [assetClassList, setAssetClassList] = useState<AssetClassWithUsage[]>([]);
  const [performance, setPerformance] = useState<PortfolioPerformanceSnapshot | null>(null);
  const [manualFxRates, setManualFxRates] = useState<ManualFxRateEntry[]>([]);

  // Holdings filters
  const [holdingSearch, setHoldingSearch] = useState<string>('');
  const [holdingPlatformFilter, setHoldingPlatformFilter] = useState<string>('all');
  const [holdingAssetClassFilter, setHoldingAssetClassFilter] = useState<string>('all');
  const [holdingCurrencyFilter, setHoldingCurrencyFilter] = useState<string>('all');
  const [holdingSortBy, setHoldingSortBy] = useState<
    'value_desc' | 'value_asc' | 'pnl_desc' | 'symbol_asc'
  >('value_desc');
  const [showZeroQtyHoldings, setShowZeroQtyHoldings] = useState<boolean>(true);
  const [filteredHoldings, setFilteredHoldings] = useState<HoldingEnriched[]>([]);

  // Activity filters
  const [activitySearch, setActivitySearch] = useState<string>('');
  const [activityPlatformFilter, setActivityPlatformFilter] = useState<string>('all');
  const [activityClassFilter, setActivityClassFilter] = useState<string>('all');
  const [activityTypeFilter, setActivityTypeFilter] = useState<InvestmentActivityType | 'all'>(
    'all'
  );
  const [activityDatePreset, setActivityDatePreset] = useState<ReportingPeriodPreset>('this_month');
  const [activityStartDate, setActivityStartDate] = useState<string>('');
  const [activityEndDate, setActivityEndDate] = useState<string>('');
  const resolvedActivityRange = getPeriodDateRange(activityDatePreset, {
    timezone, customStart: activityStartDate, customEnd: activityEndDate,
  });
  const [activitySortOrder, setActivitySortOrder] = useState<'newest' | 'oldest'>('newest');
  const [filteredActivities, setFilteredActivities] = useState<EnrichedInvestmentActivity[]>([]);

  // Pool extra currency creation
  const [newPoolCurrency, setNewPoolCurrency] = useState<string>('USD');

  // Modals
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolModalMode, setPoolModalMode] = useState<PoolTransferMode>('contribute');
  const [poolModalPlatformId, setPoolModalPlatformId] = useState<string | undefined>(undefined);

  const [holdingModalOpen, setHoldingModalOpen] = useState(false);
  const [holdingModalPlatformId, setHoldingModalPlatformId] = useState<string | undefined>(
    undefined
  );
  const [editingHolding, setEditingHolding] = useState<HoldingEnriched | null>(null);

  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalMode, setTradeModalMode] = useState<TradeActivityMode>('buy');
  const [tradeModalHolding, setTradeModalHolding] = useState<HoldingEnriched | null>(null);

  const [valuationModalOpen, setValuationModalOpen] = useState(false);
  const [valuationHolding, setValuationHolding] = useState<HoldingEnriched | null>(null);

  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [platformModalOpen, setPlatformModalOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<PlatformWithMetrics | null>(null);

  const [assetClassModalOpen, setAssetClassModalOpen] = useState(false);
  const [editingAssetClass, setEditingAssetClass] = useState<AssetClass | null>(null);

  const [fxModalOpen, setFxModalOpen] = useState(false);
  const [selectedActivityItem, setSelectedActivityItem] =
    useState<EnrichedInvestmentActivity | null>(null);

  const fetchAllInvestmentData = useCallback(async () => {
    const [ov, pool, classes, perf, fx, holdingsRows, activityRows] = await Promise.all([
      getInvestmentOverviewSnapshot({ recordOrigin: 'user', baseCurrency }),
      getInvestmentPoolSummary({ recordOrigin: 'user' }),
      listAssetClassesWithUsage({ recordOrigin: 'user' }),
      getPortfolioPerformanceHistory({ recordOrigin: 'user' }),
      getManualFxRates(),
      listHoldingsWithMetrics({
        recordOrigin: 'user',
        search: holdingSearch,
        platformId: holdingPlatformFilter,
        assetClassId: holdingAssetClassFilter,
        currency: holdingCurrencyFilter,
        includeZeroQuantity: showZeroQtyHoldings,
        sortBy: holdingSortBy,
      }),
      listInvestmentActivitiesFiltered({
        recordOrigin: 'user',
        search: activitySearch,
        platformId: activityPlatformFilter,
        assetClassId: activityClassFilter,
        activityType: activityTypeFilter,
        startDate: resolvedActivityRange.startDate,
        endDate: resolvedActivityRange.endDate,
        sortOrder: activitySortOrder,
      }),
    ]);

    return { ov, pool, classes, perf, fx, holdingsRows, activityRows };
  }, [
    baseCurrency,
    holdingSearch,
    holdingPlatformFilter,
    holdingAssetClassFilter,
    holdingCurrencyFilter,
    showZeroQtyHoldings,
    holdingSortBy,
    activitySearch,
    activityPlatformFilter,
    activityClassFilter,
    activityTypeFilter,
    activityStartDate,
    activityEndDate,
    activityDatePreset,
    activitySortOrder,
  ]);

  useEffect(() => {
    let active = true;
    fetchAllInvestmentData()
      .then((res) => {
        if (!active) return;
        setOverview(res.ov);
        setPoolSummary(res.pool);
        setAssetClassList(res.classes);
        setPerformance(res.perf);
        setManualFxRates(res.fx);
        setFilteredHoldings(res.holdingsRows);
        setFilteredActivities(res.activityRows);
      })
      .catch((err) => {
        if (active) notifyError('Failed to load investment portfolio', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchAllInvestmentData, reloadTick, notifyError]);

  const triggerReload = useCallback(async () => {
    const res = await fetchAllInvestmentData();
    setOverview(res.ov);
    setPoolSummary(res.pool);
    setAssetClassList(res.classes);
    setPerformance(res.perf);
    setManualFxRates(res.fx);
    setFilteredHoldings(res.holdingsRows);
    setFilteredActivities(res.activityRows);
    setReloadTick((t) => t + 1);
  }, [fetchAllInvestmentData]);

  // Derived active overview metrics based on selected currency scope
  const activeCurrencyCode = useMemo(() => {
    if (selectedCurrencyScope !== 'ALL_CONVERTED') return selectedCurrencyScope;
    if (overview?.convertedTotals.canConvertAll) return overview.baseCurrency;
    return overview?.currencies[0] ?? baseCurrency;
  }, [selectedCurrencyScope, overview, baseCurrency]);

  const activeOverviewKpis = useMemo(() => {
    if (!overview) return null;
    if (selectedCurrencyScope === 'ALL_CONVERTED' && overview.convertedTotals.canConvertAll) {
      const c = overview.convertedTotals;
      const simpleReturn =
        c.netContributions > 0
          ? Math.round((c.totalInvestmentGainLoss / c.netContributions) * 10000) / 100
          : null;
      const nativeBase = overview.byCurrency[overview.baseCurrency];
      return {
        currency: overview.baseCurrency,
        isConverted: overview.currencies.length > 1,
        totalInvestmentValue: c.totalInvestmentValue,
        netContributions: c.netContributions,
        grossContributions:
          overview.currencies.length === 1 && nativeBase ? nativeBase.grossContributions : null,
        withdrawals:
          overview.currencies.length === 1 && nativeBase
            ? nativeBase.withdrawalsToMainBalance
            : null,
        unrealizedPnl: c.unrealizedPnl,
        unrealizedPnlPct: c.unrealizedPnlPct,
        realizedPnl: c.realizedPnl,
        totalGainLoss: c.totalInvestmentGainLoss,
        simpleReturnPct: simpleReturn,
        totalNetWorth: c.totalNetWorth,
        poolBalance:
          overview.currencies.length === 1 && nativeBase ? nativeBase.investmentPoolBalance : null,
        platformCashBalance:
          overview.currencies.length === 1 && nativeBase ? nativeBase.platformCashBalance : null,
      };
    }

    const bucket =
      overview.byCurrency[activeCurrencyCode] ??
      overview.byCurrency[overview.baseCurrency] ??
      Object.values(overview.byCurrency)[0];
    if (!bucket) return null;

    const nwBucket = overview.netWorth.byCurrency[bucket.currency];
    return {
      currency: bucket.currency,
      isConverted: false,
      totalInvestmentValue: bucket.totalInvestmentValue,
      netContributions: bucket.netContributions,
      grossContributions: bucket.grossContributions,
      withdrawals: bucket.withdrawalsToMainBalance,
      unrealizedPnl: bucket.unrealizedPnl,
      unrealizedPnlPct: bucket.unrealizedPnlPct,
      realizedPnl: bucket.realizedPnl,
      totalGainLoss: bucket.totalInvestmentGainLoss,
      simpleReturnPct: bucket.simpleReturnOnNetContributionsPct,
      totalNetWorth: nwBucket?.totalNetWorth ?? bucket.totalInvestmentValue,
      poolBalance: bucket.investmentPoolBalance,
      platformCashBalance: bucket.platformCashBalance,
    };
  }, [overview, selectedCurrencyScope, activeCurrencyCode]);

  const allocationChartData: AllocationChartRow[] = useMemo(() => {
    if (!overview) return [];
    if (selectedCurrencyScope === 'ALL_CONVERTED' && overview.convertedTotals.canConvertAll) {
      return overview.convertedAssetAllocation.map((row) => ({
        id: row.assetClassId,
        name: row.assetClassName,
        marketValue: row.convertedMarketValue,
        percentage: row.percentage,
        pnl: row.convertedPnl,
      }));
    }
    const native = overview.assetAllocationByCurrency[activeCurrencyCode] ?? [];
    return native.map((row) => ({
      id: row.assetClassId,
      name: row.assetClassName,
      marketValue: row.marketValue,
      percentage: row.percentageOfCurrencyHoldings,
      pnl: row.totalPnl,
    }));
  }, [overview, selectedCurrencyScope, activeCurrencyCode]);

  const performanceCurrency = useMemo(() => {
    if (selectedCurrencyScope !== 'ALL_CONVERTED') return selectedCurrencyScope;
    return baseCurrency;
  }, [selectedCurrencyScope, baseCurrency]);

  const performancePoints = useMemo(() => {
    if (!performance) return [];
    return (performance.pointsByCurrency[performanceCurrency] ?? []).map((p) => ({
      date: p.date,
      portfolioValue: p.portfolioValue,
      cumulativeNetContributions: p.cumulativeNetContributions,
    }));
  }, [performance, performanceCurrency]);

  const allAssetClasses = useMemo(
    () => assetClassList.map((item) => item.assetClass),
    [assetClassList]
  );

  const openTradeModal = (mode: TradeActivityMode, holding: HoldingEnriched | null = null) => {
    setTradeModalMode(mode);
    setTradeModalHolding(holding);
    setTradeModalOpen(true);
  };

  const openPoolModal = (mode: PoolTransferMode, platformId?: string) => {
    setPoolModalMode(mode);
    setPoolModalPlatformId(platformId);
    setPoolModalOpen(true);
  };

  const handleTogglePlatform = async (plat: PlatformWithMetrics) => {
    try {
      await toggleInvestmentPlatformStatus(plat.platform.id, !plat.platform.isArchived);
      notifySuccess(
        `Platform "${plat.platform.name}" ${plat.platform.isArchived ? 'enabled' : 'disabled'}.`
      );
      await triggerReload();
    } catch (err) {
      notifyError('Failed to toggle platform status', err);
    }
  };

  const handleToggleAssetClass = async (ac: AssetClass) => {
    try {
      await toggleAssetClassEnabled(ac.id, Boolean(ac.isArchived));
      notifySuccess(`Asset class "${ac.name}" ${ac.isArchived ? 'enabled' : 'disabled'}.`);
      await triggerReload();
    } catch (err) {
      notifyError('Failed to update asset class status', err);
    }
  };

  const handleCreateCurrencyPool = async () => {
    try {
      const account = await ensureInvestmentPoolAccount(newPoolCurrency);
      notifySuccess(`Investment Pool (${account.currency}) is ready.`);
      await triggerReload();
    } catch (err) {
      notifyError('Failed to create currency pool', err);
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    const ok = await confirm({
      title: 'Delete Valuation Snapshot?',
      description: 'This removes the historical valuation checkpoint from your performance chart.',
      confirmLabel: 'Delete Snapshot',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteValuationSnapshot(snapshotId);
      notifySuccess('Valuation snapshot deleted.');
      await triggerReload();
    } catch (err) {
      notifyError('Failed to delete snapshot', err);
    }
  };

  const currencySelectorOptions = useMemo(() => {
    const list = overview?.currencies ?? [baseCurrency];
    return [
      { value: 'ALL_CONVERTED', label: `All (Converted to ${baseCurrency})` },
      ...list.map((code) => ({ value: code, label: `${code} (Native)` })),
    ];
  }, [overview, baseCurrency]);

  return (
    <AppLayout>
      <PageContainer maxWidth="wide">
        <PageHeader
          title={t('page.investments.title')}
          description={t('page.investments.description')}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => openPoolModal('contribute')}>
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Pool Transfer</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingHolding(null);
                  setHoldingModalPlatformId(selectedPlatformId ?? undefined);
                  setHoldingModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Holding</span>
              </Button>
              <Button size="sm" onClick={() => openTradeModal('buy', null)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Record Trade / Income</span>
              </Button>
            </div>
          }
        />

        {/* Internal Section Tabs */}
        <div
          role="tablist"
          aria-label="Investment sections"
          className="mb-6 flex items-center gap-1.5 overflow-x-auto border-b border-line pb-3"
        >
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== 'platforms') setSelectedPlatformId(null);
                }}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-brand-primary text-brand-primary-foreground'
                    : 'bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading && !overview ? (
          <Card padding="lg">
            <div className="flex items-center gap-2.5 text-sm text-ink-muted">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Loading local investment portfolio...</span>
            </div>
          </Card>
        ) : null}

        {/* ================================================================
            TAB 1: OVERVIEW
        ================================================================ */}
        {activeTab === 'overview' && overview ? (
          <div className="space-y-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-xs text-ink-muted">
                Balances & holdings reconcile directly with the unified local account balance engine.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-56">
                  <Select
                    aria-label="Portfolio currency display"
                    value={selectedCurrencyScope}
                    onChange={(e) => setSelectedCurrencyScope(e.target.value)}
                    options={currencySelectorOptions}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setFxModalOpen(true)}>
                  Manage FX Rates
                </Button>
              </div>
            </div>

            {selectedCurrencyScope === 'ALL_CONVERTED' &&
            overview.convertedTotals.missingCurrencies.length > 0 ? (
              <Card padding="sm" className="border-status-warning/50 bg-status-warning/10">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="text-xs text-ink">
                    <p className="font-semibold">
                      Manual FX rate required to consolidate{' '}
                      <span className="font-mono">
                        {overview.convertedTotals.missingCurrencies.join(', ')}
                      </span>{' '}
                      into <span className="font-mono">{overview.baseCurrency}</span>
                    </p>
                    <p className="mt-0.5 text-ink-muted">
                      Multi-currency holdings are never added together blindly. Enter explicit
                      manual FX rates or select a native currency view above.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setFxModalOpen(true)}>
                    Set Manual FX Rate
                  </Button>
                </div>
              </Card>
            ) : null}

            {/* Primary KPI Cards */}
            {activeOverviewKpis ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Card padding="md">
                    <p className="text-xs text-ink-muted">
                      Total Investment Value ({activeOverviewKpis.currency})
                    </p>
                    <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-ink">
                      {formatCurrency(
                        activeOverviewKpis.totalInvestmentValue,
                        activeOverviewKpis.currency,
                        numberFormat
                      )}
                    </p>
                    {activeOverviewKpis.poolBalance !== null &&
                    activeOverviewKpis.platformCashBalance !== null ? (
                      <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
                        Pool:{' '}
                        {formatCurrency(
                          activeOverviewKpis.poolBalance,
                          activeOverviewKpis.currency,
                          numberFormat
                        )}{' '}
                        · Cash:{' '}
                        {formatCurrency(
                          activeOverviewKpis.platformCashBalance,
                          activeOverviewKpis.currency,
                          numberFormat
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-ink-muted">
                        Converted using recorded manual FX rates
                      </p>
                    )}
                  </Card>

                  <Card padding="md">
                    <p className="text-xs text-ink-muted">Net Contributions</p>
                    <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-ink">
                      {formatCurrency(
                        activeOverviewKpis.netContributions,
                        activeOverviewKpis.currency,
                        numberFormat
                      )}
                    </p>
                    {activeOverviewKpis.grossContributions !== null ? (
                      <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
                        In:{' '}
                        {formatCurrency(
                          activeOverviewKpis.grossContributions,
                          activeOverviewKpis.currency,
                          numberFormat
                        )}{' '}
                        · Out:{' '}
                        {formatCurrency(
                          activeOverviewKpis.withdrawals ?? 0,
                          activeOverviewKpis.currency,
                          numberFormat
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-ink-muted">Contributions − Withdrawals</p>
                    )}
                  </Card>

                  <Card padding="md">
                    <p className="text-xs text-ink-muted">Unrealized P/L</p>
                    <p
                      className={cn(
                        'mt-1.5 text-2xl font-semibold tracking-tight tabular-nums',
                        activeOverviewKpis.unrealizedPnl > 0
                          ? 'text-status-success'
                          : activeOverviewKpis.unrealizedPnl < 0
                            ? 'text-status-danger'
                            : 'text-ink'
                      )}
                    >
                      {activeOverviewKpis.unrealizedPnl > 0 ? '+' : ''}
                      {formatCurrency(
                        activeOverviewKpis.unrealizedPnl,
                        activeOverviewKpis.currency,
                        numberFormat
                      )}
                    </p>
                    <p className="mt-1 text-[11px] tabular-nums text-ink-muted">
                      {activeOverviewKpis.unrealizedPnlPct !== null
                        ? `${formatSensitiveSignedNumber(activeOverviewKpis.unrealizedPnlPct, 2)}% vs remaining cost basis`
                        : 'No open cost basis yet'}
                    </p>
                  </Card>

                  <Card padding="md">
                    <p className="text-xs text-ink-muted">Realized P/L</p>
                    <p
                      className={cn(
                        'mt-1.5 text-2xl font-semibold tracking-tight tabular-nums',
                        activeOverviewKpis.realizedPnl > 0
                          ? 'text-status-success'
                          : activeOverviewKpis.realizedPnl < 0
                            ? 'text-status-danger'
                            : 'text-ink'
                      )}
                    >
                      {activeOverviewKpis.realizedPnl > 0 ? '+' : ''}
                      {formatCurrency(
                        activeOverviewKpis.realizedPnl,
                        activeOverviewKpis.currency,
                        numberFormat
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-muted">Closed & partial sells</p>
                  </Card>
                </div>

                {/* Secondary Financial Summary Strip */}
                <Card padding="sm" className="bg-surface-muted/40">
                  <div className="grid gap-4 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-ink-muted">Total Investment Gain/Loss</span>
                      <p
                        className={cn(
                          'mt-0.5 font-semibold tabular-nums',
                          activeOverviewKpis.totalGainLoss > 0
                            ? 'text-status-success'
                            : activeOverviewKpis.totalGainLoss < 0
                              ? 'text-status-danger'
                              : 'text-ink'
                        )}
                      >
                        {activeOverviewKpis.totalGainLoss > 0 ? '+' : ''}
                        {formatCurrency(
                          activeOverviewKpis.totalGainLoss,
                          activeOverviewKpis.currency,
                          numberFormat
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-ink-muted">Simple Return on Net Contributions</span>
                      <p className="mt-0.5 font-semibold tabular-nums text-ink">
                        {activeOverviewKpis.simpleReturnPct !== null
                          ? `${formatSensitiveSignedNumber(activeOverviewKpis.simpleReturnPct, 2)}%`
                          : '— (Requires Net Contributions > 0)'}
                      </p>
                    </div>
                    <div>
                      <span className="text-ink-muted">
                        Unified Total Net Worth ({activeOverviewKpis.currency})
                      </span>
                      <p className="mt-0.5 font-semibold tabular-nums text-brand-primary dark:text-brand-secondary">
                        {formatCurrency(
                          activeOverviewKpis.totalNetWorth,
                          activeOverviewKpis.currency,
                          numberFormat
                        )}
                      </p>
                    </div>
                  </div>
                </Card>
              </>
            ) : null}

            {/* Native Currency Breakdown Cards when multi-currency exists */}
            {overview.currencies.length > 1 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {overview.currencies.map((code) => {
                  const bucket = overview.byCurrency[code];
                  if (!bucket) return null;
                  return (
                    <Card key={code} padding="sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-ink">
                          {code} Portfolio
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedCurrencyScope(code)}
                          className="text-[11px] font-medium text-brand-accent hover:underline"
                        >
                          Inspect {code}
                        </button>
                      </div>
                      <p className="mt-1 text-base font-semibold tabular-nums text-ink">
                        {formatCurrency(bucket.totalInvestmentValue, code, numberFormat)}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-ink-muted">
                        Holdings: {formatCurrency(bucket.holdingsMarketValue, code, numberFormat)} ·
                        Cash:{' '}
                        {formatCurrency(
                          bucket.investmentPoolBalance + bucket.platformCashBalance,
                          code,
                          numberFormat
                        )}
                      </p>
                    </Card>
                  );
                })}
              </div>
            ) : null}

            {/* Asset Allocation + Performance Chart */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card padding="md" className="lg:col-span-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink">Asset Allocation</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('asset_classes')}
                    className="text-xs font-medium text-brand-accent hover:underline"
                  >
                    Manage Classes
                  </button>
                </div>
                <AssetAllocationChart
                  data={allocationChartData}
                  currency={activeCurrencyCode}
                  numberFormat={numberFormat}
                />
              </Card>

              <Card padding="md" className="lg:col-span-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink">
                    Performance History ({performanceCurrency})
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSnapshotModalOpen(true)}
                  >
                    Record Snapshot
                  </Button>
                </div>
                <PerformanceHistoryChart
                  data={performancePoints}
                  currency={performanceCurrency}
                  numberFormat={numberFormat}
                  dateFormat={dateFormat}
                />
              </Card>
            </div>

            {/* Platform Overview Cards */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Investment Platforms</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('platforms')}
                  className="text-xs font-medium text-brand-accent hover:underline"
                >
                  View All Platforms
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {overview.platforms
                  .filter((p) => !p.platform.isArchived)
                  .map((p) => (
                    <Card
                      key={p.platform.id}
                      padding="md"
                      className="cursor-pointer transition-colors hover:border-brand-accent/60"
                      onClick={() => {
                        setSelectedPlatformId(p.platform.id);
                        setActiveTab('platforms');
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink">{p.platform.name}</p>
                          <p className="text-[11px] capitalize text-ink-muted">
                            {p.platform.kind.replace('_', ' ')} · {p.currency}
                          </p>
                        </div>
                        <span className="font-mono text-[11px] text-ink-muted">
                          {p.activeHoldingCount} active
                        </span>
                      </div>
                      <p className="mt-3 text-lg font-semibold tabular-nums text-ink">
                        {formatCurrency(p.totalPlatformValue, p.currency, numberFormat)}
                      </p>
                      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-muted">
                        <span>Cash: {formatCurrency(p.cashBalance, p.currency, numberFormat)}</span>
                        <span>
                          Holdings: {formatCurrency(p.holdingsValue, p.currency, numberFormat)}
                        </span>
                      </div>
                    </Card>
                  ))}
              </div>
            </div>

            {/* Holdings Summary + Recent Investment Activity */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card padding="none" className="overflow-hidden lg:col-span-7">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <h2 className="text-sm font-semibold text-ink">Top Holdings</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('holdings')}
                    className="text-xs font-medium text-brand-accent hover:underline"
                  >
                    View All ({overview.holdings.length})
                  </button>
                </div>
                {overview.holdings.length === 0 ? (
                  <div className="px-5 py-8 text-center text-xs text-ink-muted">
                    No holdings created yet. Click &ldquo;Add Holding&rdquo; to register your first
                    investment asset.
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    {overview.holdings.slice(0, 6).map((h) => (
                      <div
                        key={h.holding.id}
                        className="flex items-center justify-between gap-3 px-5 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">
                            {h.holding.symbol}{' '}
                            <span className="font-normal text-ink-muted">· {h.holding.name}</span>
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-muted">
                            {h.platformName} · Qty{' '}
                            <span className="font-mono tabular-nums">
                              {formatNumericValue(
                                h.quantity,
                                h.quantity % 1 === 0 ? 0 : 4,
                                numberFormat
                              )}
                            </span>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="text-right tabular-nums">
                            <p className="font-semibold text-ink">
                              {h.priceRecorded
                                ? formatCurrency(h.marketValue, h.holding.currency, numberFormat)
                                : 'Price Not Recorded'}
                            </p>
                            <p
                              className={cn(
                                'text-[11px]',
                                h.unrealizedPnl > 0
                                  ? 'text-status-success'
                                  : h.unrealizedPnl < 0
                                    ? 'text-status-danger'
                                    : 'text-ink-muted'
                              )}
                            >
                              {h.priceRecorded
                                ? `${h.unrealizedPnl > 0 ? '+' : ''}${formatCurrency(h.unrealizedPnl, h.holding.currency, numberFormat)}`
                                : 'Price Not Recorded'}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openTradeModal('buy', h)}
                          >
                            Buy
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card padding="none" className="overflow-hidden lg:col-span-5">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <h2 className="text-sm font-semibold text-ink">Recent Activity</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('activity')}
                    className="text-xs font-medium text-brand-accent hover:underline"
                  >
                    Full Log
                  </button>
                </div>
                {overview.recentActivities.length === 0 ? (
                  <div className="px-5 py-8 text-center text-xs text-ink-muted">
                    No investment activity recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    {overview.recentActivities.slice(0, 7).map((item) => {
                      const act = item.activity;
                      const isPositive =
                        act.activityType === 'dividend' ||
                        act.activityType === 'interest' ||
                        act.activityType === 'contribution';
                      const isOut = act.activityType === 'buy' || act.activityType === 'fee';
                      return (
                        <div
                          key={act.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedActivityItem(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedActivityItem(item);
                            }
                          }}
                          className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-xs hover:bg-surface-muted/50"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {act.description || act.activityType}
                            </p>
                            <p className="mt-0.5 text-[11px] text-ink-muted">
                              <span className="tabular-nums">
                                {formatDisplayDate(act.activityDate, dateFormat)}
                              </span>{' '}
                              · {item.platformName}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 font-semibold tabular-nums',
                              isPositive
                                ? 'text-status-success'
                                : isOut
                                  ? 'text-status-danger'
                                  : 'text-ink'
                            )}
                          >
                            {formatCurrency(
                              act.netAmount ?? act.grossAmount,
                              act.currency,
                              numberFormat
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        ) : null}

        {/* ================================================================
            TAB 2: PLATFORMS (LIST + PLATFORM DETAIL)
        ================================================================ */}
        {activeTab === 'platforms' && overview ? (
          selectedPlatformId ? (
            <PlatformDetailPanel
              platformId={selectedPlatformId}
              onBack={() => setSelectedPlatformId(null)}
              onBuyHolding={(h) => openTradeModal('buy', h)}
              onSellHolding={(h) => openTradeModal('sell', h)}
              onValuateHolding={(h) => {
                setValuationHolding(h);
                setValuationModalOpen(true);
              }}
              onAddHolding={(platId) => {
                setEditingHolding(null);
                setHoldingModalPlatformId(platId);
                setHoldingModalOpen(true);
              }}
              onSelectActivity={(act) => {
                const enriched =
                  filteredActivities.find((x) => x.activity.id === act.id) ??
                  overview.recentActivities.find((x) => x.activity.id === act.id);
                if (enriched) {
                  setSelectedActivityItem(enriched);
                } else {
                  const plat = overview.platforms.find((p) => p.platform.id === act.platformId);
                  setSelectedActivityItem({
                    activity: act,
                    platformName: plat?.platform.name ?? 'Platform',
                  });
                }
              }}
              reloadKey={reloadTick}
              numberFormat={numberFormat}
              dateFormat={dateFormat}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-xs text-ink-muted">
                  Each platform manages a linked investment cash account alongside its custody
                  holdings.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPoolModal('platform_transfer')}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Transfer Pool ↔ Platform</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingPlatform(null);
                      setPlatformModalOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add Platform</span>
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {overview.platforms.map((p) => (
                  <Card
                    key={p.platform.id}
                    padding="md"
                    className={cn(p.platform.isArchived && 'opacity-70')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-ink">{p.platform.name}</h3>
                        <p className="text-xs text-ink-muted">
                          <span className="capitalize">{p.platform.kind.replace('_', ' ')}</span> ·{' '}
                          <span className="font-mono">{p.currency}</span> ·{' '}
                          {p.platform.isArchived ? 'Disabled' : 'Enabled'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingPlatform(p);
                          setPlatformModalOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </Button>
                    </div>

                    <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs tabular-nums">
                      <div className="flex justify-between">
                        <span className="text-ink-muted">Platform Cash</span>
                        <span className="font-medium text-ink">
                          {formatCurrency(p.cashBalance, p.currency, numberFormat)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-muted">Holdings Value</span>
                        <span className="font-medium text-ink">
                          {formatCurrency(p.holdingsValue, p.currency, numberFormat)}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-line pt-1.5">
                        <span className="font-medium text-ink">Total Platform Value</span>
                        <span className="font-semibold text-brand-primary dark:text-brand-secondary">
                          {formatCurrency(p.totalPlatformValue, p.currency, numberFormat)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-muted">Unrealized / Realized</span>
                        <span
                          className={
                            p.unrealizedPnl >= 0 ? 'text-status-success' : 'text-status-danger'
                          }
                        >
                          {p.unrealizedPnl > 0 ? '+' : ''}
                          {formatCurrency(p.unrealizedPnl, p.currency, numberFormat)} /{' '}
                          {formatCurrency(p.realizedPnlTotal, p.currency, numberFormat)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTogglePlatform(p)}
                      >
                        {p.platform.isArchived ? 'Enable' : 'Disable'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setSelectedPlatformId(p.platform.id)}
                      >
                        View Details
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )
        ) : null}

        {/* ================================================================
            TAB 3: ASSET CLASSES
        ================================================================ */}
        {activeTab === 'asset_classes' ? (
          <div className="space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-xs text-ink-muted">
                Default and custom asset classes used to classify holdings and compute allocation.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setEditingAssetClass(null);
                  setAssetClassModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Asset Class</span>
              </Button>
            </div>

            <Card padding="none" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted/70 text-ink-muted">
                      <th className="px-5 py-3 font-semibold">Asset Class</th>
                      <th className="px-4 py-3 font-semibold">Code</th>
                      <th className="px-4 py-3 font-semibold">Description</th>
                      <th className="px-4 py-3 text-right font-semibold">Holdings</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {assetClassList.map(({ assetClass, holdingCount }) => (
                      <tr key={assetClass.id} className="hover:bg-surface-muted/40">
                        <td className="px-5 py-3 font-semibold text-ink">
                          {assetClass.name}
                          {assetClass.isDefault ? (
                            <span className="ml-2 text-[11px] font-normal text-ink-muted">
                              (Default)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-ink-muted">{assetClass.code}</td>
                        <td className="px-4 py-3 text-ink-muted">
                          {assetClass.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                          {holdingCount}
                        </td>
                        <td className="px-4 py-3 text-ink">
                          {assetClass.isArchived ? 'Disabled' : 'Enabled'}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingAssetClass(assetClass);
                                setAssetClassModalOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleAssetClass(assetClass)}
                            >
                              {assetClass.isArchived ? 'Enable' : 'Disable'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ) : null}

        {/* ================================================================
            TAB 4: HOLDINGS
        ================================================================ */}
        {activeTab === 'holdings' && overview ? (
          <div className="space-y-4">
            <Card padding="sm">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
                <div className="relative lg:col-span-2">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    aria-label="Search holdings"
                    value={holdingSearch}
                    onChange={(e) => setHoldingSearch(e.target.value)}
                    placeholder="Search ticker, asset name, platform..."
                    className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-ink-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  />
                </div>

                <Select
                  aria-label="Filter holdings by platform"
                  value={holdingPlatformFilter}
                  onChange={(e) => setHoldingPlatformFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Platforms' },
                    ...overview.platforms.map((p) => ({
                      value: p.platform.id,
                      label: p.platform.name,
                    })),
                  ]}
                />

                <Select
                  aria-label="Filter holdings by asset class"
                  value={holdingAssetClassFilter}
                  onChange={(e) => setHoldingAssetClassFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Asset Classes' },
                    ...allAssetClasses.map((ac) => ({ value: ac.id, label: ac.name })),
                  ]}
                />

                <Select
                  aria-label="Filter holdings by currency"
                  value={holdingCurrencyFilter}
                  onChange={(e) => setHoldingCurrencyFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Currencies' },
                    ...overview.currencies.map((c) => ({ value: c, label: c })),
                  ]}
                />

                <Select
                  aria-label="Sort holdings"
                  value={holdingSortBy}
                  onChange={(e) =>
                    setHoldingSortBy(
                      e.target.value as 'value_desc' | 'value_asc' | 'pnl_desc' | 'symbol_asc'
                    )
                  }
                  options={[
                    { value: 'value_desc', label: 'Value: High to Low' },
                    { value: 'value_asc', label: 'Value: Low to High' },
                    { value: 'pnl_desc', label: 'Unrealized P/L' },
                    { value: 'symbol_asc', label: 'Symbol (A-Z)' },
                  ]}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
                <label className="flex items-center gap-2 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={showZeroQtyHoldings}
                    onChange={(e) => setShowZeroQtyHoldings(e.target.checked)}
                    className="h-4 w-4 rounded border-line"
                  />
                  <span>Include zero-quantity / closed positions</span>
                </label>

                <Button
                  size="sm"
                  onClick={() => {
                    setEditingHolding(null);
                    setHoldingModalPlatformId(undefined);
                    setHoldingModalOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Holding</span>
                </Button>
              </div>
            </Card>

            {filteredHoldings.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-5 w-5" />}
                title="No investment holdings match your filters"
                description="Add a holding on one of your investment platforms or reset filters to view all positions."
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingHolding(null);
                      setHoldingModalOpen(true);
                    }}
                  >
                    Add Holding
                  </Button>
                }
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted/70 text-ink-muted">
                        <th className="px-4 py-3 font-semibold">Asset</th>
                        <th className="px-3 py-3 font-semibold">Platform</th>
                        <th className="px-3 py-3 font-semibold">Class</th>
                        <th className="px-3 py-3 text-right font-semibold">Qty</th>
                        <th className="px-3 py-3 text-right font-semibold">Avg Cost</th>
                        <th className="px-3 py-3 text-right font-semibold">Price</th>
                        <th className="px-3 py-3 text-right font-semibold">Market Value</th>
                        <th className="px-3 py-3 text-right font-semibold">Unrealized P/L</th>
                        <th className="px-4 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredHoldings.map((h) => (
                        <tr key={h.holding.id} className="hover:bg-surface-muted/40">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-ink">
                              {h.holding.symbol}{' '}
                              <span className="font-mono text-[10px] font-normal text-ink-muted">
                                {h.holding.currency}
                              </span>
                            </p>
                            <p className="text-[11px] text-ink-muted">{h.holding.name}</p>
                          </td>
                          <td className="px-3 py-3 text-ink-muted">{h.platformName}</td>
                          <td className="px-3 py-3 text-ink-muted">{h.assetClassName}</td>
                          <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
                            {formatNumericValue(
                              h.quantity,
                              h.quantity % 1 === 0 ? 0 : 4,
                              numberFormat
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                            {formatCurrency(h.averageCostPerUnit, h.holding.currency, numberFormat)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-ink">
                          {h.priceRecorded && h.currentPrice !== null
                            ? formatCurrency(h.currentPrice, h.holding.currency, numberFormat)
                            : 'Price Not Recorded'}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                            {h.priceRecorded
                              ? formatCurrency(h.marketValue, h.holding.currency, numberFormat)
                              : 'Price Not Recorded'}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-3 text-right font-medium tabular-nums',
                              h.unrealizedPnl > 0
                                ? 'text-status-success'
                                : h.unrealizedPnl < 0
                                  ? 'text-status-danger'
                                  : 'text-ink-muted'
                            )}
                          >
                            <p>
                              {h.priceRecorded
                                ? `${h.unrealizedPnl > 0 ? '+' : ''}${formatCurrency(h.unrealizedPnl, h.holding.currency, numberFormat)}`
                                : 'Price Not Recorded'}
                            </p>
                            {h.priceRecorded && h.unrealizedPnlPct !== null ? (
                              <p className="text-[11px]">
                                {formatSensitiveSignedNumber(h.unrealizedPnlPct, 2)}%
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openTradeModal('buy', h)}
                              >
                                Buy
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={h.quantity <= 0}
                                onClick={() => openTradeModal('sell', h)}
                              >
                                Sell
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setValuationHolding(h);
                                  setValuationModalOpen(true);
                                }}
                              >
                                Record Price
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingHolding(h);
                                  setHoldingModalOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        ) : null}

        {/* ================================================================
            TAB 5: ACTIVITY LOG
        ================================================================ */}
        {activeTab === 'activity' && overview ? (
          <div className="space-y-4">
            <Card padding="sm">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
                <div className="relative lg:col-span-2">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    aria-label="Search investment activities"
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Search symbol, platform, description..."
                    className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-ink-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  />
                </div>

                <Select
                  aria-label="Filter activity by platform"
                  value={activityPlatformFilter}
                  onChange={(e) => setActivityPlatformFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Platforms' },
                    ...overview.platforms.map((p) => ({
                      value: p.platform.id,
                      label: p.platform.name,
                    })),
                  ]}
                />

                <Select
                  aria-label="Filter activity by asset class"
                  value={activityClassFilter}
                  onChange={(e) => setActivityClassFilter(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Asset Classes' },
                    ...allAssetClasses.map((ac) => ({ value: ac.id, label: ac.name })),
                  ]}
                />

                <Select
                  aria-label="Filter activity by type"
                  value={activityTypeFilter}
                  onChange={(e) =>
                    setActivityTypeFilter(e.target.value as InvestmentActivityType | 'all')
                  }
                  options={[
                    { value: 'all', label: 'All Types' },
                    { value: 'contribution', label: 'Contribution' },
                    { value: 'withdrawal', label: 'Withdrawal' },
                    { value: 'platform_transfer', label: 'Platform Transfer' },
                    { value: 'buy', label: 'Buy' },
                    { value: 'sell', label: 'Sell' },
                    { value: 'dividend', label: 'Dividend' },
                    { value: 'interest', label: 'Interest' },
                    { value: 'fee', label: 'Fee' },
                    { value: 'valuation_update', label: 'Valuation Update' },
                  ]}
                />

                <Select
                  aria-label="Sort activities"
                  value={activitySortOrder}
                  onChange={(e) => setActivitySortOrder(e.target.value as 'newest' | 'oldest')}
                  options={[
                    { value: 'newest', label: 'Newest First' },
                    { value: 'oldest', label: 'Oldest First' },
                  ]}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <DateRangeFilter value={activityDatePreset} onPresetChange={setActivityDatePreset}
                    startDate={activityStartDate} endDate={activityEndDate}
                    onStartDateChange={setActivityStartDate} onEndDateChange={setActivityEndDate}
                    className="flex flex-wrap items-end gap-2" />
                </div>
                <Button size="sm" onClick={() => openTradeModal('buy', null)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Record Activity</span>
                </Button>
              </div>
            </Card>

            {filteredActivities.length === 0 ? (
              <EmptyState
                icon={<Coins className="h-5 w-5" />}
                title="No investment activities found"
                description="Record contributions, platform transfers, buys, sells, dividends, or valuations to build your audit trail."
                action={
                  <Button size="sm" onClick={() => openTradeModal('buy', null)}>
                    Record First Activity
                  </Button>
                }
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted/70 text-ink-muted">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-3 py-3 font-semibold">Type</th>
                        <th className="px-3 py-3 font-semibold">Asset / Description</th>
                        <th className="px-3 py-3 font-semibold">Platform</th>
                        <th className="px-3 py-3 text-right font-semibold">Qty</th>
                        <th className="px-3 py-3 text-right font-semibold">Price</th>
                        <th className="px-3 py-3 text-right font-semibold">Amount</th>
                        <th className="px-4 py-3 text-right font-semibold">Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredActivities.map((item) => {
                        const act = item.activity;
                        const isPositive =
                          act.activityType === 'dividend' ||
                          act.activityType === 'interest' ||
                          act.activityType === 'contribution' ||
                          act.activityType === 'sell' ||
                          act.activityType === 'partial_sell';
                        const isOut = act.activityType === 'buy' || act.activityType === 'fee';
                        return (
                          <tr
                            key={act.id}
                            onClick={() => setSelectedActivityItem(item)}
                            className="cursor-pointer hover:bg-surface-muted/50"
                          >
                            <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink">
                              {formatDisplayDate(act.activityDate, dateFormat)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 capitalize text-ink">
                              {act.activityType.replace('_', ' ')}
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-medium text-ink">
                                {item.holdingSymbol
                                  ? `${item.holdingSymbol} — ${act.description || ''}`
                                  : act.description || act.activityType}
                              </p>
                              {act.realizedPnl !== undefined ? (
                                <p
                                  className={cn(
                                    'text-[11px] tabular-nums',
                                    act.realizedPnl >= 0
                                      ? 'text-status-success'
                                      : 'text-status-danger'
                                  )}
                                >
                                  Realized P/L: {act.realizedPnl > 0 ? '+' : ''}
                                  {formatCurrency(act.realizedPnl, act.currency, numberFormat)}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 text-ink-muted">{item.platformName}</td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-muted">
                              {act.quantity !== undefined
                                ? formatNumericValue(
                                    act.quantity,
                                    act.quantity % 1 === 0 ? 0 : 4,
                                    numberFormat
                                  )
                                : '—'}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                              {act.unitPrice !== undefined
                                ? formatCurrency(act.unitPrice, act.currency, numberFormat)
                                : '—'}
                            </td>
                            <td
                              className={cn(
                                'whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums',
                                isPositive
                                  ? 'text-status-success'
                                  : isOut
                                    ? 'text-status-danger'
                                    : 'text-ink'
                              )}
                            >
                              {isPositive ? (
                                <TrendingUp className="mr-1 inline h-3 w-3" aria-hidden="true" />
                              ) : null}
                              {isOut ? (
                                <TrendingDown className="mr-1 inline h-3 w-3" aria-hidden="true" />
                              ) : null}
                              {formatCurrency(
                                act.netAmount ?? act.grossAmount,
                                act.currency,
                                numberFormat
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-muted">
                              {act.feeAmount > 0
                                ? formatCurrency(act.feeAmount, act.currency, numberFormat)
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        ) : null}

        {/* ================================================================
            TAB 6: INVESTMENT POOL
        ================================================================ */}
        {activeTab === 'pool' && poolSummary ? (
          <div className="space-y-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-xs text-ink-muted">
                Unallocated investment reserve between your Main Accounts and individual Platform
                Cash accounts.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => openPoolModal('contribute')}>
                  Contribute
                </Button>
                <Button variant="outline" size="sm" onClick={() => openPoolModal('withdraw')}>
                  Withdraw
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openPoolModal('platform_transfer')}
                >
                  Transfer to Platform
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Object.values(poolSummary.totalsByCurrency).map((bucket) => (
                <Card key={bucket.currency} padding="md">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink">
                      Investment Pool ({bucket.currency})
                    </p>
                    <Wallet className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                    {formatCurrency(bucket.poolBalance, bucket.currency, numberFormat)}
                  </p>
                  <div className="mt-3 space-y-1 border-t border-line pt-2.5 text-xs tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Gross Contributions</span>
                      <span className="text-ink">
                        {formatCurrency(bucket.grossContributions, bucket.currency, numberFormat)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Withdrawals to Main</span>
                      <span className="text-ink">
                        {formatCurrency(bucket.totalWithdrawals, bucket.currency, numberFormat)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Net Contributions</span>
                      <span className="font-semibold text-ink">
                        {formatCurrency(bucket.netContributions, bucket.currency, numberFormat)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Allocated to Platforms</span>
                      <span className="text-ink">
                        {formatCurrency(
                          bucket.totalTransferredToPlatforms,
                          bucket.currency,
                          numberFormat
                        )}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}

              <Card padding="md" className="flex flex-col justify-between bg-surface-muted/30">
                <div>
                  <p className="text-xs font-semibold text-ink">Add Currency Pool</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Create an Investment Pool account in USD, USDT, SGD, or another currency to fund
                    foreign-currency platforms directly.
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <div className="flex-1">
                    <Select
                      aria-label="New pool currency"
                      value={newPoolCurrency}
                      onChange={(e) => setNewPoolCurrency(e.target.value)}
                      options={[
                        { value: 'USD', label: 'USD' },
                        { value: 'USDT', label: 'USDT' },
                        { value: 'SGD', label: 'SGD' },
                        { value: 'EUR', label: 'EUR' },
                      ]}
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={handleCreateCurrencyPool}>
                    Create Pool
                  </Button>
                </div>
              </Card>
            </div>

            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-line px-5 py-3.5">
                <h2 className="text-sm font-semibold text-ink">Pool & Capital Transfer History</h2>
              </div>
              {poolSummary.recentPoolActivities.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-ink-muted">
                  No contributions, withdrawals, or platform transfers recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {poolSummary.recentPoolActivities.map((act) => {
                    const plat = overview?.platforms.find((p) => p.platform.id === act.platformId);
                    return (
                      <div
                        key={act.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setSelectedActivityItem({
                            activity: act,
                            platformName: plat?.platform.name ?? 'Investment Pool',
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedActivityItem({
                              activity: act,
                              platformName: plat?.platform.name ?? 'Investment Pool',
                            });
                          }
                        }}
                        className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3 text-xs hover:bg-surface-muted/50"
                      >
                        <div>
                          <p className="font-medium text-ink">
                            {act.description || act.activityType}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-muted">
                            <span className="tabular-nums">
                              {formatDisplayDate(act.activityDate, dateFormat)}
                            </span>{' '}
                            · <span className="capitalize">{act.activityType.replace('_', ' ')}</span>
                          </p>
                        </div>
                        <span className="font-semibold tabular-nums text-ink">
                          {formatCurrency(act.grossAmount, act.currency, numberFormat)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        ) : null}

        {/* ================================================================
            TAB 7: PERFORMANCE HISTORY
        ================================================================ */}
        {activeTab === 'performance' && performance ? (
          <div className="space-y-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="w-56">
                <Select
                  aria-label="Performance currency"
                  value={performanceCurrency}
                  onChange={(e) => setSelectedCurrencyScope(e.target.value)}
                  options={(overview?.currencies ?? [baseCurrency]).map((c) => ({
                    value: c,
                    label: `${c} Valuation History`,
                  }))}
                />
              </div>
              <Button size="sm" onClick={() => setSnapshotModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Record Snapshot</span>
              </Button>
            </div>

            <Card padding="md">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">
                  Portfolio Value vs Invested Capital ({performanceCurrency})
                </h2>
                <PieChartIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              </div>
              <PerformanceHistoryChart
                data={performancePoints}
                currency={performanceCurrency}
                numberFormat={numberFormat}
                dateFormat={dateFormat}
              />
              <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
                {performance.returnMethodologyNote}
              </p>
            </Card>

            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-line px-5 py-3.5">
                <h2 className="text-sm font-semibold text-ink">Recorded Valuation Snapshots</h2>
              </div>
              {performance.snapshots.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-ink-muted">
                  No historical valuation snapshots recorded yet. Update a holding price or record a
                  manual portfolio checkpoint above.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted/70 text-ink-muted">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-3 py-3 font-semibold">Scope</th>
                        <th className="px-3 py-3 font-semibold">Currency</th>
                        <th className="px-3 py-3 text-right font-semibold">Market Value</th>
                        <th className="px-3 py-3 text-right font-semibold">Cost Basis</th>
                        <th className="px-3 py-3 font-semibold">Notes</th>
                        <th className="px-4 py-3 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {performance.snapshots.map((snap) => (
                        <tr key={snap.id} className="hover:bg-surface-muted/40">
                          <td className="px-4 py-3 tabular-nums text-ink">
                            {formatDisplayDate(snap.valuationDate, dateFormat)}
                          </td>
                          <td className="px-3 py-3 capitalize text-ink">{snap.scope}</td>
                          <td className="px-3 py-3 font-mono text-ink-muted">{snap.currency}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                            {formatCurrency(snap.marketValue, snap.currency, numberFormat)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                            {snap.costBasis !== undefined
                              ? formatCurrency(snap.costBasis, snap.currency, numberFormat)
                              : '—'}
                          </td>
                          <td className="px-3 py-3 text-ink-muted">{snap.notes || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteSnapshot(snap.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-status-danger" aria-hidden="true" />
                              <span className="text-status-danger">Delete</span>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : null}
      </PageContainer>

      {/* ================================================================
          MODALS
      ================================================================ */}
      {poolSummary && overview ? (
        <PoolTransferModal
          open={poolModalOpen}
          onClose={() => setPoolModalOpen(false)}
          onSaved={triggerReload}
          initialMode={poolModalMode}
          initialPlatformId={poolModalPlatformId}
          poolAccounts={poolSummary.poolAccounts}
          mainAccounts={poolSummary.sourceMainAccounts}
          platforms={overview.platforms}
          timezone={timezone}
          numberFormat={numberFormat}
        />
      ) : null}

      {overview ? (
        <>
          <HoldingModal
            open={holdingModalOpen}
            onClose={() => {
              setHoldingModalOpen(false);
              setEditingHolding(null);
            }}
            onSaved={triggerReload}
            platforms={overview.platforms}
            assetClasses={allAssetClasses}
            initialPlatformId={holdingModalPlatformId}
            editingHolding={editingHolding}
          />

          <TradeOrIncomeModal
            open={tradeModalOpen}
            onClose={() => {
              setTradeModalOpen(false);
              setTradeModalHolding(null);
            }}
            onSaved={triggerReload}
            initialMode={tradeModalMode}
            initialHolding={tradeModalHolding}
            platforms={overview.platforms}
            holdings={overview.holdings}
            timezone={timezone}
            numberFormat={numberFormat}
          />

          <ValuationUpdateModal
            open={valuationModalOpen}
            onClose={() => {
              setValuationModalOpen(false);
              setValuationHolding(null);
            }}
            onSaved={triggerReload}
            holding={valuationHolding}
            baseCurrency={baseCurrency}
            timezone={timezone}
            numberFormat={numberFormat}
            dateFormat={dateFormat}
          />

          <PortfolioSnapshotModal
            open={snapshotModalOpen}
            onClose={() => setSnapshotModalOpen(false)}
            onSaved={triggerReload}
            platforms={overview.platforms}
            baseCurrency={baseCurrency}
            timezone={timezone}
            defaultCurrency={performanceCurrency}
            defaultMarketValue={overview.byCurrency[performanceCurrency]?.totalInvestmentValue}
            defaultCostBasis={overview.byCurrency[performanceCurrency]?.remainingCostBasis}
          />

          <PlatformModal
            open={platformModalOpen}
            onClose={() => {
              setPlatformModalOpen(false);
              setEditingPlatform(null);
            }}
            onSaved={triggerReload}
            editingPlatform={editingPlatform}
          />

          <AssetClassModal
            open={assetClassModalOpen}
            onClose={() => {
              setAssetClassModalOpen(false);
              setEditingAssetClass(null);
            }}
            onSaved={triggerReload}
            editingAssetClass={editingAssetClass}
          />

          <FxRateModal
            open={fxModalOpen}
            onClose={() => setFxModalOpen(false)}
            onSaved={triggerReload}
            baseCurrency={baseCurrency}
            rates={manualFxRates}
            missingCurrencies={overview.convertedTotals.missingCurrencies}
            timezone={timezone}
            numberFormat={numberFormat}
            dateFormat={dateFormat}
          />

          <ActivityDetailAndEditModal
            open={Boolean(selectedActivityItem)}
            onClose={() => setSelectedActivityItem(null)}
            onSaved={triggerReload}
            item={selectedActivityItem}
            numberFormat={numberFormat}
            dateFormat={dateFormat}
          />
        </>
      ) : null}
    </AppLayout>
  );
}
