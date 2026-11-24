'use client';

import React from 'react';
import {
  Area,
  AreaChart,
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
import { formatCompactFinancialAxis, formatSensitiveNumber } from '@/lib/privacy-mode';
import type { DateFormatPreference, NumberFormatPreference } from '@/types/entities';

const CHART_COLORS = [
  '#0f2942',
  '#0d9488',
  '#4a6fa5',
  '#d97706',
  '#2563eb',
  '#16a34a',
  '#7c3aed',
];

export interface AllocationChartRow {
  id: string;
  name: string;
  marketValue: number;
  percentage: number;
  pnl: number;
}

export function AssetAllocationChart({
  data,
  currency,
  numberFormat,
}: {
  data: AllocationChartRow[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  const nonZero = data.filter((d) => d.marketValue > 0);

  if (nonZero.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-4 text-center text-xs text-ink-muted">
        Asset allocation chart will appear once you hold positive market value in this currency.
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-12 lg:items-center">
      <div className="h-56 w-full lg:col-span-5">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={nonZero}
              dataKey="marketValue"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={82}
              paddingAngle={2}
            >
              {nonZero.map((entry, idx) => (
                <Cell key={entry.id} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: unknown) => formatCurrency(Number(value) || 0, currency, numberFormat)}
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
        {nonZero.map((row, idx) => (
          <div key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                aria-hidden="true"
              />
              <span className="truncate font-medium text-ink">{row.name}</span>
              <span className="font-mono tabular-nums text-ink-muted">
                {formatSensitiveNumber(row.percentage, 1)}%
              </span>
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <p className="font-semibold text-ink">
                {formatCurrency(row.marketValue, currency, numberFormat)}
              </p>
              <p
                className={
                  row.pnl > 0
                    ? 'text-[11px] text-status-success'
                    : row.pnl < 0
                      ? 'text-[11px] text-status-danger'
                      : 'text-[11px] text-ink-muted'
                }
              >
                P/L: {row.pnl > 0 ? '+' : ''}
                {formatCurrency(row.pnl, currency, numberFormat)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PerformanceChartPoint {
  date: string;
  portfolioValue: number;
  cumulativeNetContributions: number | null;
}

export function PerformanceHistoryChart({
  data,
  currency,
  numberFormat,
  dateFormat,
}: {
  data: PerformanceChartPoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-4 text-center text-xs text-ink-muted">
        Performance history will appear after valuation records are created.
      </div>
    );
  }

  const hasContributions = data.some((d) => d.cumulativeNetContributions !== null);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => formatDisplayDate(v, dateFormat)}
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
            labelFormatter={(label: unknown) => formatDisplayDate(String(label ?? ''), dateFormat)}
            formatter={(value: unknown, name: unknown) => [
              formatCurrency(Number(value) || 0, currency, numberFormat),
              String(name ?? ''),
            ]}
            contentStyle={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              borderRadius: '0.5rem',
              fontSize: '12px',
              color: 'var(--color-text-primary)',
            }}
          />
          <Area
            type="monotone"
            dataKey="portfolioValue"
            name="Portfolio Value"
            stroke="#0d9488"
            strokeWidth={2}
            fill="#0d9488"
            fillOpacity={0.12}
          />
          {hasContributions ? (
            <Area
              type="monotone"
              dataKey="cumulativeNetContributions"
              name="Invested Capital"
              stroke="#4a6fa5"
              strokeWidth={2}
              fill="#4a6fa5"
              fillOpacity={0.08}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
