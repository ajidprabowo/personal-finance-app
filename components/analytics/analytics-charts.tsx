'use client';

import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
} from '@/lib/privacy-mode';
import type { NetWorthTrendResult } from '@/services/dashboard-chart.service';
import type {
  ExpenseCategoryBreakdownItem,
  ExpenseTrendPoint,
} from '@/services/expense-analytics.service';
import type { IncomeTrendPoint } from '@/services/income-analytics.service';
import type {
  InvestmentActivityTrendPoint,
  InvestmentValueTrendPoint,
} from '@/services/investment-analytics.service';
import type { MonthlySavingsPoint } from '@/services/savings-analytics.service';
import type { DateFormatPreference, NumberFormatPreference } from '@/types/entities';

const CHART_PALETTE = [
  '#0f2942',
  '#0d9488',
  '#4a6fa5',
  '#d97706',
  '#2563eb',
  '#16a34a',
  '#7c3aed',
  '#dc2626',
];

export function IncomeTrendChart({
  points,
  currency,
  numberFormat,
}: {
  points: IncomeTrendPoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        No recorded income transactions match the active filters. Internal transfers are excluded.
      </div>
    );
  }

  return (
    <div className="h-60 w-full">
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
            width={62}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const pt = payload[0]?.payload as IncomeTrendPoint | undefined;
              if (!pt) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{pt.label}</p>
                  <p className="mt-1 font-mono font-semibold text-status-success">
                    Income: {formatCurrency(pt.amount, currency, numberFormat)}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {pt.transactionCount} transaction{pt.transactionCount === 1 ? '' : 's'}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="amount" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpenseCategoryDonutChart({
  items,
  currency,
  numberFormat,
  onSelectCategory,
}: {
  items: ExpenseCategoryBreakdownItem[];
  currency: string;
  numberFormat: NumberFormatPreference;
  onSelectCategory?: (categoryId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        No recorded expenses in the selected reporting period.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={items}
            dataKey="amount"
            nameKey="categoryName"
            cx="50%"
            cy="50%"
            innerRadius={56}
            outerRadius={92}
            paddingAngle={2}
            onClick={(_data, index) => {
              const item = items[index];
              if (onSelectCategory && item?.categoryId) {
                onSelectCategory(item.categoryId);
              }
            }}
          >
            {items.map((item, idx) => (
              <Cell
                key={item.categoryId}
                fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
                className={onSelectCategory ? 'cursor-pointer' : undefined}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const item = payload[0]?.payload as ExpenseCategoryBreakdownItem | undefined;
              if (!item) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{item.categoryName}</p>
                  <p className="mt-1 font-mono font-semibold text-ink">
                    {formatCurrency(item.amount, currency, numberFormat)} (
                    {formatSensitiveNumber(item.percentageOfTotal, 1)}%)
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {item.transactionCount} transaction{item.transactionCount === 1 ? '' : 's'}
                  </p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpenseTrendSeriesChart({
  points,
  currency,
  numberFormat,
}: {
  points: ExpenseTrendPoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        No expense trend points available for the selected filters.
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
            width={62}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const pt = payload[0]?.payload as ExpenseTrendPoint | undefined;
              if (!pt) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{pt.label}</p>
                  <p className="mt-1 font-mono font-semibold text-status-danger">
                    Expenses: {formatCurrency(pt.amount, currency, numberFormat)}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {pt.transactionCount} expense{pt.transactionCount === 1 ? '' : 's'}
                  </p>
                </div>
              );
            }}
          />
          <Bar
            dataKey="amount"
            name="Expenses"
            fill="#d97706"
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpenseCategoryHorizontalChart({
  items,
  currency,
  numberFormat,
}: {
  items: ExpenseCategoryBreakdownItem[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  const top = items.slice(0, 8);
  if (top.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        No category expense data to compare.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={top}
          layout="vertical"
          margin={{ top: 6, right: 20, left: 10, bottom: 0 }}
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
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as ExpenseCategoryBreakdownItem | undefined;
              if (!row) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{row.categoryName}</p>
                  <p className="mt-1 font-mono font-semibold text-ink">
                    {formatCurrency(row.amount, currency, numberFormat)}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {formatSensitiveNumber(row.percentageOfTotal, 1)}% of period expenses
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="amount" fill="#0f2942" radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SavingsMonthlyTrendChart({
  points,
  currency,
  numberFormat,
}: {
  points: MonthlySavingsPoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        Record income and expense transactions to chart monthly savings trends.
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
            width={62}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const pt = payload[0]?.payload as MonthlySavingsPoint | undefined;
              if (!pt) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">
                    {pt.label} {pt.isIncompletePeriod ? '(In progress)' : ''}
                  </p>
                  <p className="mt-1 font-mono text-status-success">
                    Income: {formatCurrency(pt.income, currency, numberFormat)}
                  </p>
                  <p className="font-mono text-status-danger">
                    Expenses: {formatCurrency(pt.expenses, currency, numberFormat)}
                  </p>
                  <p className="mt-0.5 border-t border-line pt-1 font-mono font-semibold text-ink">
                    Savings: {formatCurrency(pt.savings, currency, numberFormat)}
                    {pt.savingsRatePct !== null
                      ? ` (${formatSensitiveNumber(pt.savingsRatePct, 1)}%)`
                      : ''}
                  </p>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="income" name="Income" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar
            dataKey="expenses"
            name="Expenses"
            fill="#d97706"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
          <Bar
            dataKey="savings"
            name="Net Savings"
            fill="#0d9488"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InvestmentActivityHistoryChart({
  points,
  currency,
  numberFormat,
}: {
  points: InvestmentActivityTrendPoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        No investment contributions, buys, sells, or dividends recorded in this period.
      </div>
    );
  }

  return (
    <div className="h-60 w-full">
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
            width={62}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const pt = payload[0]?.payload as InvestmentActivityTrendPoint | undefined;
              if (!pt) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{pt.label}</p>
                  <p className="mt-1 font-mono text-ink">
                    Contributions: {formatCurrency(pt.contributions, currency, numberFormat)}
                  </p>
                  <p className="font-mono text-ink">
                    Buys: {formatCurrency(pt.buys, currency, numberFormat)}
                  </p>
                  <p className="font-mono text-ink-muted">
                    Withdrawals: {formatCurrency(pt.withdrawals, currency, numberFormat)}
                  </p>
                  <p className="font-mono text-status-success">
                    Dividends/Interest:{' '}
                    {formatCurrency(pt.dividendsAndInterest, currency, numberFormat)}
                  </p>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar
            dataKey="contributions"
            name="Contributions"
            fill="#0d9488"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
          <Bar dataKey="buys" name="Buys" fill="#0f2942" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar
            dataKey="dividendsAndInterest"
            name="Dividends/Int"
            fill="#16a34a"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InvestmentValueHistoryChart({
  points,
  currency,
  numberFormat,
  dateFormat,
}: {
  points: InvestmentValueTrendPoint[];
  currency: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs leading-relaxed text-ink-muted">
        At least two dated portfolio valuation snapshots are needed to plot portfolio value
        history without fabricating intermediate prices.
      </div>
    );
  }

  return (
    <div className="h-60 w-full">
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
            width={62}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const pt = payload[0]?.payload as InvestmentValueTrendPoint | undefined;
              if (!pt) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">
                    {formatDisplayDate(pt.date, dateFormat)}
                  </p>
                  <p className="mt-1 font-mono font-semibold text-ink">
                    Value: {formatCurrency(pt.portfolioValue, currency, numberFormat)}
                  </p>
                  {pt.costBasis !== null ? (
                    <p className="font-mono text-ink-muted">
                      Cost Basis: {formatCurrency(pt.costBasis, currency, numberFormat)}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    Source: {pt.source === 'snapshot' ? 'Saved Valuation Snapshot' : 'Current Holdings'}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="portfolioValue"
            name="Portfolio Value"
            stroke="#4a6fa5"
            strokeWidth={2}
            fill="#4a6fa5"
            fillOpacity={0.14}
            dot={{ r: 3, fill: 'var(--color-surface)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetWorthAnalyticsTrendChart({
  trend,
  numberFormat,
  dateFormat,
}: {
  trend: NetWorthTrendResult;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}) {
  if (!trend.hasSufficientData || trend.points.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs leading-relaxed text-ink-muted">
        {trend.insufficientReason ||
          'At least two distinct dated checkpoints are needed to plot Net Worth growth.'}
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trend.points} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
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
            width={62}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const pt = payload[0]?.payload as NetWorthTrendResult['points'][number] | undefined;
              if (!pt) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">
                    {formatDisplayDate(pt.date, dateFormat)}
                  </p>
                  <p className="mt-1 font-mono font-semibold text-ink">
                    Net Worth: {formatCurrency(pt.netWorth, trend.currency, numberFormat)}
                  </p>
                  <p className="font-mono text-ink-muted">
                    Cash: {formatCurrency(pt.availableCash, trend.currency, numberFormat)}
                  </p>
                  <p className="font-mono text-ink-muted">
                    Investments: {formatCurrency(pt.investmentValue, trend.currency, numberFormat)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    Source:{' '}
                    {pt.dataSource === 'snapshot'
                      ? 'Includes valuation snapshot'
                      : 'Reconstructed from transactions'}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            name="Net Worth"
            stroke="#0f2942"
            strokeWidth={2}
            fill="#0f2942"
            fillOpacity={0.12}
            dot={{ r: 3, fill: 'var(--color-surface)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
