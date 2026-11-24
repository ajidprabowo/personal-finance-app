'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useNotifications } from '@/hooks/use-notifications';
import { formatCurrency, formatNumericValue } from '@/lib/currency';
import { formatSensitiveNumber, formatSensitiveSignedNumber } from '@/lib/privacy-mode';
import { formatDisplayDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { HoldingEnriched } from '@/services/holding.service';
import {
  getPlatformDetail,
  type PlatformDetailSnapshot,
} from '@/services/investment-platform.service';
import type {
  DateFormatPreference,
  InvestmentActivity,
  InvestmentActivityType,
  NumberFormatPreference,
} from '@/types/entities';

export interface PlatformDetailPanelProps {
  platformId: string;
  onBack: () => void;
  onBuyHolding: (holding: HoldingEnriched) => void;
  onSellHolding: (holding: HoldingEnriched) => void;
  onValuateHolding: (holding: HoldingEnriched) => void;
  onAddHolding: (platformId: string) => void;
  onSelectActivity: (activity: InvestmentActivity) => void;
  reloadKey: number;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}

export function PlatformDetailPanel({
  platformId,
  onBack,
  onBuyHolding,
  onSellHolding,
  onValuateHolding,
  onAddHolding,
  onSelectActivity,
  reloadKey,
  numberFormat,
  dateFormat,
}: PlatformDetailPanelProps) {
  const { notifyError } = useNotifications();
  const [detail, setDetail] = useState<PlatformDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityType, setActivityType] = useState<InvestmentActivityType | 'all'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    let active = true;
    getPlatformDetail(platformId, {
      activityType,
      startDate: startDate || null,
      endDate: endDate || null,
      recordOrigin: 'user',
    })
      .then((res) => {
        if (active) setDetail(res);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load platform details', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [platformId, activityType, startDate, endDate, reloadKey, notifyError]);

  if (loading && !detail) {
    return (
      <Card padding="lg">
        <p className="text-sm text-ink-muted">Loading platform detail...</p>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card padding="lg">
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">Platform details unavailable.</p>
          <Button variant="outline" size="sm" onClick={onBack}>
            Back to Platforms
          </Button>
        </div>
      </Card>
    );
  }

  const { summary, holdings, assetAllocation, activities } = detail;
  const currency = summary.currency;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>All Platforms</span>
          </Button>
          <div>
            <h2 className="text-lg font-semibold text-ink">{summary.platform.name}</h2>
            <p className="text-xs text-ink-muted">
              <span className="capitalize">{summary.platform.kind.replace('_', ' ')}</span> ·{' '}
              <span className="font-mono">{currency}</span> ·{' '}
              {summary.platform.isArchived ? 'Disabled' : 'Enabled'}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => onAddHolding(summary.platform.id)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add Holding on {summary.platform.name}</span>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="md">
          <p className="text-xs text-ink-muted">Platform Cash Balance</p>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-ink">
            {formatCurrency(summary.cashBalance, currency, numberFormat)}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-ink-muted">Total Holdings Value</p>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-ink">
            {formatCurrency(summary.holdingsValue, currency, numberFormat)}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-ink-muted">Total Platform Value</p>
          <p className="mt-1.5 text-xl font-semibold tabular-nums text-brand-primary dark:text-brand-secondary">
            {formatCurrency(summary.totalPlatformValue, currency, numberFormat)}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-ink-muted">Unrealized / Realized P/L</p>
          <p
            className={cn(
              'mt-1.5 text-base font-semibold tabular-nums',
              summary.unrealizedPnl > 0
                ? 'text-status-success'
                : summary.unrealizedPnl < 0
                  ? 'text-status-danger'
                  : 'text-ink'
            )}
          >
            {summary.unrealizedPnl > 0 ? '+' : ''}
            {formatCurrency(summary.unrealizedPnl, currency, numberFormat)}
            {summary.unrealizedPnlPct !== null
              ? ` (${formatSensitiveSignedNumber(summary.unrealizedPnlPct, 2)}%)`
              : ''}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
            Realized: {formatCurrency(summary.realizedPnlTotal, currency, numberFormat)}
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card padding="md" className="lg:col-span-4">
          <h3 className="text-sm font-semibold text-ink">Asset Allocation on Platform</h3>
          {assetAllocation.length === 0 ? (
            <p className="mt-4 text-xs text-ink-muted">
              No holdings valued on {summary.platform.name} yet.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-line">
              {assetAllocation.map((slice) => (
                <div key={slice.assetClassId} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-medium text-ink">{slice.assetClassName}</p>
                    <p className="font-mono tabular-nums text-ink-muted">
                      {formatSensitiveNumber(slice.percentage, 1)}%
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-semibold text-ink">
                      {formatCurrency(slice.marketValue, currency, numberFormat)}
                    </p>
                    <p
                      className={
                        slice.unrealizedPnl >= 0 ? 'text-status-success' : 'text-status-danger'
                      }
                    >
                      {slice.unrealizedPnl > 0 ? '+' : ''}
                      {formatCurrency(slice.unrealizedPnl, currency, numberFormat)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="none" className="overflow-hidden lg:col-span-8">
          <div className="border-b border-line px-5 py-3.5">
            <h3 className="text-sm font-semibold text-ink">Holdings on {summary.platform.name}</h3>
          </div>
          {holdings.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-ink-muted">
              No holdings registered on this platform yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface-muted/70 text-ink-muted">
                    <th className="px-4 py-2.5 font-semibold">Asset</th>
                    <th className="px-3 py-2.5 font-semibold">Class</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Avg Cost</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Price / Market Value</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Unrealized P/L</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {holdings.map((h) => (
                    <tr key={h.holding.id} className="hover:bg-surface-muted/40">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">{h.holding.symbol}</p>
                        <p className="text-[11px] text-ink-muted">{h.holding.name}</p>
                      </td>
                      <td className="px-3 py-3 text-ink-muted">{h.assetClassName}</td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
                        {formatNumericValue(h.quantity, h.quantity % 1 === 0 ? 0 : 4, numberFormat)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                        {formatCurrency(h.averageCostPerUnit, h.holding.currency, numberFormat)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                        {h.priceRecorded && h.currentPrice !== null
                          ? <>
                              <p>{formatCurrency(h.currentPrice, h.holding.currency, numberFormat)}</p>
                              <p className="text-[11px] font-normal text-ink-muted">
                                {formatCurrency(h.marketValue, h.holding.currency, numberFormat)}
                              </p>
                            </>
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
                        {h.priceRecorded
                          ? `${h.unrealizedPnl > 0 ? '+' : ''}${formatCurrency(h.unrealizedPnl, h.holding.currency, numberFormat)}`
                          : 'Price Not Recorded'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => onBuyHolding(h)}>
                            Buy
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={h.quantity <= 0}
                            onClick={() => onSellHolding(h)}
                          >
                            Sell
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => onValuateHolding(h)}>
                            Record Price
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Platform Investment Activity History with Date & Type Filters */}
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-col justify-between gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
          <h3 className="text-sm font-semibold text-ink">Platform Activity History</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <Select
                aria-label="Filter platform activity type"
                value={activityType}
                onChange={(e) => setActivityType(e.target.value as InvestmentActivityType | 'all')}
                options={[
                  { value: 'all', label: 'All Activity Types' },
                  { value: 'platform_transfer', label: 'Platform Transfer' },
                  { value: 'buy', label: 'Buy' },
                  { value: 'sell', label: 'Sell' },
                  { value: 'dividend', label: 'Dividend' },
                  { value: 'interest', label: 'Interest' },
                  { value: 'fee', label: 'Fee' },
                  { value: 'valuation_update', label: 'Valuation Update' },
                ]}
              />
            </div>
            <input
              type="date"
              aria-label="Filter start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            />
            <input
              type="date"
              aria-label="Filter end date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            />
          </div>
        </div>

        {activities.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-muted">
            No investment activities match the current filters on {summary.platform.name}.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {activities.map((item) => {
              const act = item.activity;
              const isGain = act.activityType === 'dividend' || act.activityType === 'interest';
              const isOut = act.activityType === 'buy' || act.activityType === 'fee';
              return (
                <div
                  key={act.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectActivity(act)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectActivity(act);
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3 text-xs transition-colors hover:bg-surface-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">
                      {act.description || act.activityType}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      <span className="tabular-nums">
                        {formatDisplayDate(act.activityDate, dateFormat)}
                      </span>{' '}
                      · <span className="capitalize">{act.activityType.replace('_', ' ')}</span>
                      {item.holdingSymbol ? ` · ${item.holdingSymbol}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p
                      className={cn(
                        'inline-flex items-center gap-1 font-semibold',
                        isGain
                          ? 'text-status-success'
                          : isOut
                            ? 'text-status-danger'
                            : 'text-ink'
                      )}
                    >
                      {isGain ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : null}
                      {isOut ? <TrendingDown className="h-3 w-3" aria-hidden="true" /> : null}
                      {formatCurrency(
                        act.netAmount ?? act.grossAmount,
                        act.currency,
                        numberFormat
                      )}
                    </p>
                    {act.feeAmount > 0 ? (
                      <p className="text-[11px] text-ink-muted">
                        Fee: {formatCurrency(act.feeAmount, act.currency, numberFormat)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
