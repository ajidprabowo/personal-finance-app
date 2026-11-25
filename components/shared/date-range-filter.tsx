'use client';

import React from 'react';
import { Select } from '@/components/ui/select';
import { useI18n } from '@/hooks/use-i18n';
import { isValidDateRange, type ReportingPeriodPreset } from '@/lib/dates';

export const DATE_RANGE_PRESETS: Array<{ value: ReportingPeriodPreset; label: string }> = [
  { value: 'this_month', label: 'This Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];

export function DateRangeFilter({
  value,
  onPresetChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  variant = 'select',
  className,
  onPresetSelect,
}: {
  value: ReportingPeriodPreset;
  onPresetChange: (value: ReportingPeriodPreset) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  variant?: 'select' | 'buttons';
  className?: string;
  onPresetSelect?: (value: ReportingPeriodPreset) => void;
}) {
  const { periodLabel } = useI18n();
  const invalid = !isValidDateRange({ startDate: startDate || null, endDate: endDate || null });
  const options = DATE_RANGE_PRESETS.map((item) => ({
    value: item.value,
    label: periodLabel(item.value),
  }));
  const dates = value === 'custom' ? (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-ink">Start Date</label>
        <input type="date" aria-label="Custom start date" value={startDate}
          max={endDate || undefined} onChange={(event) => onStartDateChange(event.target.value)}
          className="h-10 rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink">End Date</label>
        <input type="date" aria-label="Custom end date" value={endDate}
          min={startDate || undefined} onChange={(event) => onEndDateChange(event.target.value)}
          className="h-10 rounded-lg border border-line bg-surface px-3 text-xs tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
      </div>
      {invalid ? <p role="alert" className="w-full text-xs text-status-danger">Start date must be on or before end date.</p> : null}
    </div>
  ) : null;

  return (
    <div className={className}>
      {variant === 'select' ? (
        <Select label="Reporting Period" value={value}
          onChange={(event) => { const next = event.target.value as ReportingPeriodPreset; onPresetChange(next); onPresetSelect?.(next); }} options={options} />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {options.map((option) => (
            <button key={option.value} type="button" aria-pressed={value === option.value}
              onClick={() => { onPresetChange(option.value); onPresetSelect?.(option.value); }}
              className={`inline-flex h-8 items-center whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${value === option.value ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground' : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'}`}>
              {option.label}
            </button>
          ))}
        </div>
      )}
      {dates}
    </div>
  );
}
