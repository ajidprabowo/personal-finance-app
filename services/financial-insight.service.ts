import { formatCurrency } from '@/lib/currency';
import { formatDisplayDate, isDateWithinRange, type DateRange } from '@/lib/dates';
import type { AccountBalanceItem } from '@/services/account-balance.service';
import type {
  DashboardAssetAllocationResult,
  ExpenseBreakdownResult,
  NetWorthTrendResult,
} from '@/services/dashboard-chart.service';
import type {
  DateFormatPreference,
  NumberFormatPreference,
  Transaction,
} from '@/types/entities';

export type FinancialInsightTone = 'neutral' | 'positive' | 'warning';

export interface FinancialInsightItem {
  id: string;
  category:
    | 'expense_category'
    | 'largest_expense'
    | 'income_trend'
    | 'expense_trend'
    | 'savings_rate'
    | 'investment_concentration'
    | 'net_worth_change'
    | 'low_balance';
  title: string;
  description: string;
  tone: FinancialInsightTone;
}

export interface PeriodComparisonMetrics {
  currentIncome: number;
  previousIncome: number | null;
  incomeChangeAbs: number | null;
  incomeChangePct: number | null;
  currentExpenses: number;
  previousExpenses: number | null;
  expenseChangeAbs: number | null;
  expenseChangePct: number | null;
  currentNetCashFlow: number;
  previousNetCashFlow: number | null;
  netCashFlowChangeAbs: number | null;
  savingsRatePct: number | null;
}

function getLowBalanceThreshold(currency: string): number {
  const code = currency.toUpperCase();
  if (code === 'IDR' || code === 'VND' || code === 'KRW') return 100_000;
  if (code === 'JPY') return 1_000;
  return 25;
}

/**
 * Generates neutral, strictly deterministic financial observations from actual local records.
 * Never fabricates claims, never outputs speculative investment advice, and omits any insight
 * whose underlying data is insufficient.
 */
export function generateFinancialInsights(params: {
  baseCurrency: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
  dateRange: DateRange;
  transactions: Transaction[];
  comparison: PeriodComparisonMetrics;
  expenseBreakdown: ExpenseBreakdownResult;
  assetAllocation: DashboardAssetAllocationResult;
  netWorthTrend: NetWorthTrendResult;
  accountBalances: AccountBalanceItem[];
}): FinancialInsightItem[] {
  const insights: FinancialInsightItem[] = [];
  const {
    baseCurrency,
    numberFormat,
    dateFormat,
    dateRange,
    transactions,
    comparison,
    expenseBreakdown,
    assetAllocation,
    netWorthTrend,
    accountBalances,
  } = params;

  const fmt = (amt: number, cur: string = baseCurrency) =>
    formatCurrency(amt, cur, numberFormat);

  // 1. Highest Expense Category
  if (expenseBreakdown.items.length > 0 && expenseBreakdown.totalExpenses > 0) {
    const topCat = expenseBreakdown.items[0];
    insights.push({
      id: 'highest_expense_category',
      category: 'expense_category',
      title: `Top spending category: ${topCat.categoryName}`,
      description: `${topCat.categoryName} accounts for ${topCat.percentageOfTotal.toFixed(
        1
      )}% of expenses (${fmt(topCat.amount)}) across ${topCat.transactionCount} transaction${
        topCat.transactionCount === 1 ? '' : 's'
      }.`,
      tone: 'neutral',
    });
  }

  // 2. Largest Expense Transaction in selected period (matching baseCurrency)
  const periodExpenses = transactions.filter(
    (t) =>
      t.type === 'expense' &&
      t.currency.toUpperCase() === baseCurrency.toUpperCase() &&
      isDateWithinRange(t.date, dateRange)
  );
  if (periodExpenses.length > 0) {
    const largest = [...periodExpenses].sort((a, b) => b.amount - a.amount)[0];
    if (largest && largest.amount > 0) {
      insights.push({
        id: 'largest_expense_tx',
        category: 'largest_expense',
        title: `Largest expense: ${fmt(largest.amount, largest.currency)}`,
        description: `Recorded on ${formatDisplayDate(largest.date, dateFormat)} for "${
          largest.description
        }".`,
        tone: 'neutral',
      });
    }
  }

  // 3. Savings Rate (only when Income > 0)
  if (comparison.currentIncome > 0 && comparison.savingsRatePct !== null) {
    const rate = comparison.savingsRatePct;
    insights.push({
      id: 'savings_rate',
      category: 'savings_rate',
      title: `Savings rate: ${rate.toFixed(1)}% of income`,
      description:
        comparison.currentNetCashFlow >= 0
          ? `Net cash flow is +${fmt(comparison.currentNetCashFlow)} after expenses in the selected period.`
          : `Expenses exceeded income by ${fmt(Math.abs(comparison.currentNetCashFlow))} in the selected period.`,
      tone: rate >= 20 ? 'positive' : rate < 0 ? 'warning' : 'neutral',
    });
  }

  // 4. Income Trend vs Previous Period (only when previousIncome > 0)
  if (
    comparison.previousIncome !== null &&
    comparison.previousIncome > 0 &&
    comparison.incomeChangeAbs !== null &&
    comparison.incomeChangePct !== null
  ) {
    const sign = comparison.incomeChangeAbs >= 0 ? '+' : '';
    insights.push({
      id: 'income_trend',
      category: 'income_trend',
      title: `Income ${comparison.incomeChangeAbs >= 0 ? 'increased' : 'decreased'} by ${Math.abs(
        comparison.incomeChangePct
      ).toFixed(1)}%`,
      description: `Changed by ${sign}${fmt(
        comparison.incomeChangeAbs
      )} compared with the previous equivalent period (${fmt(comparison.previousIncome)}).`,
      tone: comparison.incomeChangeAbs >= 0 ? 'positive' : 'neutral',
    });
  }

  // 5. Expense Trend vs Previous Period (only when previousExpenses > 0)
  if (
    comparison.previousExpenses !== null &&
    comparison.previousExpenses > 0 &&
    comparison.expenseChangeAbs !== null &&
    comparison.expenseChangePct !== null
  ) {
    const sign = comparison.expenseChangeAbs >= 0 ? '+' : '';
    insights.push({
      id: 'expense_trend',
      category: 'expense_trend',
      title: `Spending ${comparison.expenseChangeAbs > 0 ? 'rose' : 'fell'} ${Math.abs(
        comparison.expenseChangePct
      ).toFixed(1)}%`,
      description: `Expenses changed by ${sign}${fmt(
        comparison.expenseChangeAbs
      )} compared with ${fmt(comparison.previousExpenses)} in the prior equivalent period.`,
      tone: comparison.expenseChangeAbs > 0 ? 'warning' : 'positive',
    });
  }

  // 6. Investment Allocation Concentration
  if (
    assetAllocation.investmentOnlyItems.length > 0 &&
    assetAllocation.investmentOnlyTotalConverted > 0
  ) {
    const topClass = assetAllocation.investmentOnlyItems[0];
    if (topClass.percentage >= 50) {
      insights.push({
        id: 'investment_concentration',
        category: 'investment_concentration',
        title: `Portfolio concentrated in ${topClass.name}`,
        description: `${topClass.name} represents ${topClass.percentage.toFixed(
          1
        )}% (${fmt(topClass.value)}) of valued investment holdings.`,
        tone: 'neutral',
      });
    }
  }

  // 7. Net Worth Change across Trend (strictly when >= 2 valid historical points exist)
  if (netWorthTrend.hasSufficientData && netWorthTrend.points.length >= 2) {
    const first = netWorthTrend.points[0];
    const last = netWorthTrend.points[netWorthTrend.points.length - 1];
    const delta = last.netWorth - first.netWorth;
    const pct = first.netWorth > 0 ? (delta / first.netWorth) * 100 : null;
    insights.push({
      id: 'net_worth_change',
      category: 'net_worth_change',
      title: `Net Worth ${delta >= 0 ? 'grew' : 'decreased'} by ${fmt(Math.abs(delta))}`,
      description: `Moved from ${fmt(first.netWorth)} on ${formatDisplayDate(
        first.date,
        dateFormat
      )} to ${fmt(last.netWorth)} on ${formatDisplayDate(last.date, dateFormat)}${
        pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''
      }.`,
      tone: delta > 0 ? 'positive' : delta < 0 ? 'warning' : 'neutral',
    });
  }

  // 8. Low-balance active liquid accounts (only accounts with recorded activity or negative balance)
  const lowLiquidAccounts = accountBalances.filter((item) => {
    const acc = item.account;
    if (acc.isArchived) return false;
    if (acc.type !== 'bank' && acc.type !== 'cash' && acc.type !== 'ewallet') return false;
    const threshold = getLowBalanceThreshold(acc.currency);
    const hasActivityOrNonZeroOpening = item.transactionCount > 0 || acc.initialBalance !== 0;
    return hasActivityOrNonZeroOpening && item.currentBalance < threshold;
  });

  if (lowLiquidAccounts.length > 0) {
    const sample = lowLiquidAccounts[0];
    insights.push({
      id: 'low_balance_accounts',
      category: 'low_balance',
      title:
        lowLiquidAccounts.length === 1
          ? `Low balance in ${sample.account.name}`
          : `${lowLiquidAccounts.length} liquid accounts with low balance`,
      description:
        lowLiquidAccounts.length === 1
          ? `${sample.account.name} currently holds ${fmt(
              sample.currentBalance,
              sample.account.currency
            )}.`
          : `${lowLiquidAccounts
              .slice(0, 2)
              .map((a) => `${a.account.name} (${fmt(a.currentBalance, a.account.currency)})`)
              .join(', ')}${lowLiquidAccounts.length > 2 ? ', and others' : ''}.`,
      tone: sample.currentBalance <= 0 ? 'warning' : 'neutral',
    });
  }

  return insights;
}
