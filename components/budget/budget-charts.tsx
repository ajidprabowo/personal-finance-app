'use client';

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/currency';
import { formatCompactFinancialAxis, formatSensitiveNumber } from '@/lib/privacy-mode';
import type { ComputedBudgetItem } from '@/services/budget-calculation.service';
import type { BudgetMonthHistoryItem } from '@/services/budget.service';
import type { NumberFormatPreference } from '@/types/entities';

export function BudgetVsActualComparisonChart({
  items,
  baseCurrency,
  numberFormat,
}: {
  items: ComputedBudgetItem[];
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
}) {
  const chartData = items
    .filter((i) => i.convertedAvailableBudget !== null && i.convertedActualAmount !== null)
    .slice(0, 10)
    .map((i) => ({
      name:
        i.categoryName.length > 14 ? `${i.categoryName.slice(0, 13)}…` : i.categoryName,
      fullName: i.categoryName,
      budget: i.convertedAvailableBudget ?? 0,
      actual: i.convertedActualAmount ?? 0,
      utilizationPct: i.utilizationPct,
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        Add at least one active monthly category budget convertible to {baseCurrency} to view
        the Budget vs. Actual comparison chart.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="name"
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
              const row = payload[0]?.payload as (typeof chartData)[number] | undefined;
              if (!row) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{row.fullName}</p>
                  <p className="mt-1 font-mono tabular-nums text-ink-muted">
                    Available Budget: {formatCurrency(row.budget, baseCurrency, numberFormat)}
                  </p>
                  <p className="font-mono tabular-nums text-ink">
                    Actual Spending: {formatCurrency(row.actual, baseCurrency, numberFormat)}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-brand-primary">
                    Utilization:{' '}
                    {row.utilizationPct !== null
                      ? `${formatSensitiveNumber(row.utilizationPct, 1)}%`
                      : 'Over limit'}
                  </p>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar
            dataKey="budget"
            name="Available Budget"
            fill="#4a6fa5"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="actual"
            name="Actual Spending"
            fill="#0d9488"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BudgetHistoryTrendChart({
  history,
  baseCurrency,
  numberFormat,
}: {
  history: BudgetMonthHistoryItem[];
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
}) {
  const chronological = [...history]
    .reverse()
    .filter((h) => h.totalBudget > 0 || h.totalActualBudgetedExpenses > 0);

  if (chronological.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface-muted/40 px-6 text-center text-xs text-ink-muted">
        Monthly budget history will appear here once budgets or expenses are recorded.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chronological} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
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
              const row = payload[0]?.payload as BudgetMonthHistoryItem | undefined;
              if (!row) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold text-ink">{row.label}</p>
                  <p className="mt-1 font-mono tabular-nums text-ink-muted">
                    Total Budget: {formatCurrency(row.totalBudget, baseCurrency, numberFormat)}
                  </p>
                  <p className="font-mono tabular-nums text-ink">
                    Budgeted Actual:{' '}
                    {formatCurrency(row.totalActualBudgetedExpenses, baseCurrency, numberFormat)}
                  </p>
                  <p className="font-mono tabular-nums text-ink-muted">
                    All Expenses:{' '}
                    {formatCurrency(row.totalAllMonthExpenses, baseCurrency, numberFormat)}
                  </p>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar
            dataKey="totalBudget"
            name="Total Monthly Budget"
            fill="#0f2942"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="totalActualBudgetedExpenses"
            name="Actual Budgeted Expenses"
            fill="#d97706"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
