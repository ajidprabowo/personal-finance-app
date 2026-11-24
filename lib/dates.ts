import { APP_CONFIG } from '@/lib/config';
import type { DateFormatPreference } from '@/types/entities';

export type ReportingPeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'last_12_months'
  | 'all_time'
  | 'custom';

export interface DateRange {
  startDate: string | null;
  endDate: string | null;
}

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Returns today's calendar date (YYYY-MM-DD) in the user's configured timezone
 * (defaults to Asia/Jakarta) without UTC off-by-one drift.
 */
export function getTodayInTimezone(
  timezone: string = APP_CONFIG.defaultTimezone,
  referenceDate: Date = new Date()
): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(referenceDate);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_CONFIG.defaultTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(referenceDate);
  }
}

export function todayDateString(timezone: string = APP_CONFIG.defaultTimezone): string {
  return getTodayInTimezone(timezone);
}

export function isValidDateString(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

function subtractMonthsFromYearMonth(
  year: number,
  month1To12: number,
  deltaMonths: number
): { year: number; month: number } {
  const zeroIndexed = year * 12 + (month1To12 - 1) - deltaMonths;
  const targetYear = Math.floor(zeroIndexed / 12);
  const targetMonth = ((zeroIndexed % 12) + 12) % 12 + 1;
  return { year: targetYear, month: targetMonth };
}

export function shiftCalendarDays(dateStr: string, deltaDays: number): string {
  if (!isValidDateString(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

export function calendarDayDiff(startDate: string, endDate: string): number {
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) return 0;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

/**
 * Resolves reporting period boundaries in pure calendar YYYY-MM-DD strings
 * anchored to the configured timezone.
 */
export function getPeriodDateRange(
  preset: ReportingPeriodPreset,
  options?: {
    timezone?: string;
    customStart?: string | null;
    customEnd?: string | null;
    referenceDate?: Date;
    todayOverride?: string;
  }
): DateRange {
  if (preset === 'all_time') {
    return { startDate: null, endDate: null };
  }

  if (preset === 'custom') {
    const start = isValidDateString(options?.customStart) ? options!.customStart : null;
    const end = isValidDateString(options?.customEnd) ? options!.customEnd : null;
    if (start && end && start > end) {
      return { startDate: end, endDate: start };
    }
    return { startDate: start, endDate: end };
  }

  const today =
    options?.todayOverride && isValidDateString(options.todayOverride)
      ? options.todayOverride
      : getTodayInTimezone(
          options?.timezone ?? APP_CONFIG.defaultTimezone,
          options?.referenceDate ?? new Date()
        );
  const [year, month] = today.split('-').map(Number);

  if (preset === 'this_month') {
    const startDate = `${year}-${pad2(month)}-01`;
    const endDate = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
    return { startDate, endDate };
  }

  if (preset === 'last_month') {
    const prev = subtractMonthsFromYearMonth(year, month, 1);
    const startDate = `${prev.year}-${pad2(prev.month)}-01`;
    const endDate = `${prev.year}-${pad2(prev.month)}-${pad2(daysInMonth(prev.year, prev.month))}`;
    return { startDate, endDate };
  }

  if (preset === 'last_3_months') {
    const start = subtractMonthsFromYearMonth(year, month, 2);
    const startDate = `${start.year}-${pad2(start.month)}-01`;
    const endDate = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
    return { startDate, endDate };
  }

  if (preset === 'last_6_months') {
    const start = subtractMonthsFromYearMonth(year, month, 5);
    const startDate = `${start.year}-${pad2(start.month)}-01`;
    const endDate = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
    return { startDate, endDate };
  }

  if (preset === 'last_12_months') {
    const start = subtractMonthsFromYearMonth(year, month, 11);
    const startDate = `${start.year}-${pad2(start.month)}-01`;
    const endDate = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
    return { startDate, endDate };
  }

  if (preset === 'last_year') {
    const prevYear = year - 1;
    return {
      startDate: `${prevYear}-01-01`,
      endDate: `${prevYear}-12-31`,
    };
  }

  // this_year
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

/**
 * Computes the immediately preceding equivalent calendar period for safe period-over-period comparisons.
 * Returns null when comparison is undefined (e.g., all_time or open-ended custom range).
 */
export function getPreviousEquivalentPeriodRange(
  preset: ReportingPeriodPreset,
  currentRange: DateRange
): DateRange | null {
  if (preset === 'all_time') return null;
  if (!currentRange.startDate || !currentRange.endDate) return null;

  const [startYear, startMonth] = currentRange.startDate.split('-').map(Number);

  if (preset === 'this_month' || preset === 'last_month') {
    const prev = subtractMonthsFromYearMonth(startYear, startMonth, 1);
    return {
      startDate: `${prev.year}-${pad2(prev.month)}-01`,
      endDate: `${prev.year}-${pad2(prev.month)}-${pad2(daysInMonth(prev.year, prev.month))}`,
    };
  }

  if (preset === 'last_3_months') {
    const prevStart = subtractMonthsFromYearMonth(startYear, startMonth, 3);
    const prevEnd = subtractMonthsFromYearMonth(startYear, startMonth, 1);
    return {
      startDate: `${prevStart.year}-${pad2(prevStart.month)}-01`,
      endDate: `${prevEnd.year}-${pad2(prevEnd.month)}-${pad2(daysInMonth(prevEnd.year, prevEnd.month))}`,
    };
  }

  if (preset === 'last_6_months') {
    const prevStart = subtractMonthsFromYearMonth(startYear, startMonth, 6);
    const prevEnd = subtractMonthsFromYearMonth(startYear, startMonth, 1);
    return {
      startDate: `${prevStart.year}-${pad2(prevStart.month)}-01`,
      endDate: `${prevEnd.year}-${pad2(prevEnd.month)}-${pad2(daysInMonth(prevEnd.year, prevEnd.month))}`,
    };
  }

  if (preset === 'last_12_months') {
    const prevStart = subtractMonthsFromYearMonth(startYear, startMonth, 12);
    const prevEnd = subtractMonthsFromYearMonth(startYear, startMonth, 1);
    return {
      startDate: `${prevStart.year}-${pad2(prevStart.month)}-01`,
      endDate: `${prevEnd.year}-${pad2(prevEnd.month)}-${pad2(daysInMonth(prevEnd.year, prevEnd.month))}`,
    };
  }

  if (preset === 'this_year' || preset === 'last_year') {
    const prevYear = startYear - 1;
    return {
      startDate: `${prevYear}-01-01`,
      endDate: `${prevYear}-12-31`,
    };
  }

  // custom range with explicit startDate and endDate
  const spanDays = Math.max(0, calendarDayDiff(currentRange.startDate, currentRange.endDate));
  const prevEnd = shiftCalendarDays(currentRange.startDate, -1);
  const prevStart = shiftCalendarDays(prevEnd, -spanDays);
  return {
    startDate: prevStart,
    endDate: prevEnd,
  };
}

export function isDateWithinRange(dateStr: string, range: DateRange): boolean {
  if (!isValidDateString(dateStr)) return false;
  if (range.startDate && dateStr < range.startDate) return false;
  if (range.endDate && dateStr > range.endDate) return false;
  return true;
}

export function getWeekStartDateString(
  dateStr: string,
  firstDayOfWeek: 'monday' | 'sunday' = 'monday'
): string {
  if (!isValidDateString(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = utc.getUTCDay(); // 0 Sun .. 6 Sat
  const delta =
    firstDayOfWeek === 'sunday'
      ? -dayOfWeek
      : dayOfWeek === 0
        ? -6
        : 1 - dayOfWeek;
  return shiftCalendarDays(dateStr, delta);
}

/**
 * Formats a YYYY-MM-DD date string strictly from calendar components
 * according to the user's DateFormatPreference (zero UTC shift).
 */
export function formatDisplayDate(
  dateStr: string | null | undefined,
  format: DateFormatPreference = APP_CONFIG.defaultDateFormat
): string {
  if (!dateStr) return '—';
  if (!isValidDateString(dateStr)) {
    return formatDateOnly(dateStr);
  }
  const [year, month, day] = dateStr.split('-');
  if (format === 'YYYY-MM-DD') {
    return `${year}-${month}-${day}`;
  }
  if (format === 'MM/DD/YYYY') {
    return `${month}/${day}/${year}`;
  }
  if (format === 'DD MMM YYYY') {
    const monthLabel = MONTH_SHORT_NAMES[Number(month) - 1] ?? month;
    return `${day} ${monthLabel} ${year}`;
  }
  // Default DD/MM/YYYY
  return `${day}/${month}/${year}`;
}

export function formatTimestamp(
  isoString: string | null | undefined,
  timezone: string = APP_CONFIG.defaultTimezone
): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return isoString;
  }
}

export function formatDateOnly(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  if (isValidDateString(isoOrDate)) {
    return formatDisplayDate(isoOrDate, 'DD MMM YYYY');
  }
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return isoOrDate;

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}
