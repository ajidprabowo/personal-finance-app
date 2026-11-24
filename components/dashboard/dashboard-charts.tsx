'use client';

import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/currency';
import { formatDisplayDate } from '@/lib/dates';
import {
  formatCompactFinancialAxis,
  formatSensitiveNumber,
  formatSensitiveSignedNumber,
} from '@/lib/privacy-mode';
import { cn } from '@/lib/utils';
import type {
  DashboardAssetAllocationItem,
  ExpenseBreakdownItem,
  IncomeVsExpensePoint,
  NetWorthTrendPoint,
} from '@/services/dashboard-chart.service';
import type { DateFormatPreference, NumberFormatPreference } from '@/types/entities';

const ALLOCATION_COLORS = [
  '#0f2942',
  '#0d9488',
  '#4a6fa5',
  '#d97706',
  '#2563eb',
  '#16a34a',
  '#7c3aed',
];

export type NetWorthSeriesKey = 'netWorth' | 'availableCash' | 'investmentValue';

const SERIES_META: Record<
  NetWorthSeriesKey,
  { label: string; stroke: string; fill: string }
> = {
  netWorth: { label: 'Net Worth', stroke: '#0f2942', fill: '#0f2942' },
  availableCash: { label: 'Available Cash', stroke: '#0d9488', fill: '#0d9488' },
  investmentValue: { label: 'Investments', stroke: '#4a6fa5', fill: '#4a6fa5' },
};

export function NetWorthTrendChart({
  points,
  hasSufficientData,
  insufficientReason,
  seriesKey,
  currency,
  numberFormat,
  dateFormat,
}: {
  points: NetWorthTrendPoint[];
  hasSufficientData: boolean;
  insufficientReason?: string;
  seriesKey: NetWorthSeriesKey;
  currency: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}) {
  if (!hasSufficientData || points.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs leading-relaxed text-ink-muted">
        {insufficientReason ||
          'Historical Net Worth trend requires at least two valid dated financial checkpoints.'}
      </div>
    );
  }

  const meta = SERIES_META[seriesKey];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatCompactFinancialAxis(v, numberFormat)}
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const point = payload[0]?.payload as NetWorthTrendPoint | undefined;
              if (!point) return null;
              const val = point[seriesKey];
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">
                    {formatDisplayDate(point.date, dateFormat)}
                  </p>
                  <p className="mt-1 font-mono font-semibold tabular-nums text-ink">
                    {meta.label}: {formatCurrency(val, currency, numberFormat)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    Source:{' '}
                    {point.dataSource === 'snapshot'
                      ? 'Includes saved valuation snapshot'
                      : 'Reconstructed from dated transactions'}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey={seriesKey}
            name={meta.label}
            stroke={meta.stroke}
            strokeWidth={2}
            fill={meta.fill}
            fillOpacity={0.12}
            dot={{ r: 3, strokeWidth: 1.5, fill: 'var(--color-surface)' }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IncomeVsExpenseChart({
  points,
  currency,
  numberFormat,
}: {
  points: IncomeVsExpensePoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs leading-relaxed text-ink-muted">
        No actual income or expense transactions recorded in this reporting period. Internal
        transfers and investment funding are excluded automatically.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatCompactFinancialAxis(v, numberFormat)}
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const point = payload[0]?.payload as IncomeVsExpensePoint | undefined;
              if (!point) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm tabular-nums">
                  <p className="font-semibold text-ink">{point.label}</p>
                  <p className="mt-1 text-status-success">
                    Income: {formatCurrency(point.income, currency, numberFormat)}
                  </p>
                  <p className="mt-0.5 text-status-danger">
                    Expenses: {formatCurrency(point.expenses, currency, numberFormat)}
                  </p>
                  <p className="mt-1 border-t border-line pt-1 font-semibold text-ink">
                    Net Cash Flow: {point.netCashFlow >= 0 ? '+' : ''}
                    {formatCurrency(point.netCashFlow, currency, numberFormat)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="income" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenses" name="Expenses" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AssetAllocationBreakdownChart({
  items,
  currency,
  numberFormat,
  emptyMessage,
}: {
  items: DashboardAssetAllocationItem[];
  currency: string;
  numberFormat: NumberFormatPreference;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-4 text-center text-xs text-ink-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-12 lg:items-center">
      <div className="h-56 w-full lg:col-span-5">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
            >
              {items.map((entry, idx) => (
                <Cell key={entry.id} fill={ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: unknown) =>
                formatCurrency(Number(value) || 0, currency, numberFormat)
              }
              contentStyle={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                borderRadius: '0.5rem',
                fontSize: '12px',
                color: 'var(--color-text-primary)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="divide-y divide-line lg:col-span-7">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length] }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{item.name}</p>
                {item.detail ? (
                  <p className="truncate text-[11px] text-ink-muted">{item.detail}</p>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <p className="font-semibold text-ink">
                {formatCurrency(item.value, item.currency, numberFormat)}
              </p>
              <p className="font-mono text-[11px] text-ink-muted">
                {formatSensitiveNumber(item.percentage, 1)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExpenseBreakdownChart({
  items,
  currency,
  numberFormat,
  onSelectCategory,
}: {
  items: ExpenseBreakdownItem[];
  currency: string;
  numberFormat: NumberFormatPreference;
  onSelectCategory?: (categoryId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-4 text-center text-xs text-ink-muted">
        No expense transactions recorded in the selected reporting period.
      </div>
    );
  }

  const topForChart = items.slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={topForChart}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatCompactFinancialAxis(v, numberFormat)}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="categoryName"
              width={110}
              tick={{ fontSize: 11, fill: 'var(--color-text-primary)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value: unknown) =>
                formatCurrency(Number(value) || 0, currency, numberFormat)
              }
              contentStyle={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                borderRadius: '0.5rem',
                fontSize: '12px',
                color: 'var(--color-text-primary)',
              }}
            />
            <Bar dataKey="amount" name="Expenses" fill="#0f2942" radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="divide-y divide-line border-t border-line">
        {items.map((item) => (
          <button
            key={item.categoryId}
            type="button"
            onClick={() => onSelectCategory?.(item.categoryId)}
            className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-xs transition-colors hover:bg-surface-muted/50"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{item.categoryName}</p>
              <p className="text-[11px] tabular-nums text-ink-muted">
                {formatSensitiveNumber(item.percentageOfTotal, 1)}% of expenses · {item.transactionCount} tx
                {item.percentageChange !== null ? (
                  <span
                    className={cn(
                      'ml-1.5',
                      item.percentageChange > 0
                        ? 'text-status-danger'
                        : item.percentageChange < 0
                          ? 'text-status-success'
                          : 'text-ink-muted'
                    )}
                  >
                    ({item.percentageChange > 0 ? '+' : ''}
                    {formatSensitiveSignedNumber(item.percentageChange, 1)}% vs prior)
                  </span>
                ) : null}
              </p>
            </div>
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {formatCurrency(item.amount, item.currency, numberFormat)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
