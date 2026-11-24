import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, subtractDecimal } from '@/lib/precision';
import {
  holdingsRepository,
  investmentActivitiesRepository,
  portfolioValuationsRepository,
} from '@/repositories';
import type { PortfolioValuation, RecordOrigin } from '@/types/entities';

export interface PerformanceHistoryPoint {
  date: string;
  snapshotId: string;
  scope: PortfolioValuation['scope'];
  currency: string;
  portfolioValue: number;
  costBasis: number | null;
  cumulativeNetContributions: number | null;
  unrealizedPnlOnSnapshot: number | null;
  notes?: string;
}

export interface PortfolioPerformanceSnapshot {
  pointsByCurrency: Record<string, PerformanceHistoryPoint[]>;
  snapshots: PortfolioValuation[];
  returnMethodologyNote: string;
}

/**
 * Reconstructs historical performance exclusively from real user-recorded portfolioValuations
 * and real contribution/withdrawal activities. Never fabricates missing historical points.
 */
export async function getPortfolioPerformanceHistory(options?: {
  recordOrigin?: RecordOrigin;
}): Promise<PortfolioPerformanceSnapshot> {
  const origin = options?.recordOrigin ?? 'user';
  const [snapshots, activities, holdings] = await Promise.all([
    portfolioValuationsRepository.getByOriginSorted(origin),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
  ]);

  // Sort contribution & withdrawal activities chronologically for reconstructable invested capital
  const capitalFlows = activities
    .filter((a) => a.activityType === 'contribution' || a.activityType === 'withdrawal')
    .sort(
      (a, b) =>
        a.activityDate.localeCompare(b.activityDate) || a.createdAt.localeCompare(b.createdAt)
    );

  // When snapshots are recorded at portfolio scope, plot them directly.
  // If only holding snapshots exist for a date, aggregate latest holding snapshot per holding up to that date?
  // To avoid distorting partial snapshots, include portfolio-scope snapshots directly AND per-currency aggregated
  // holding snapshots only on dates where explicit holding snapshots exist.
  const holdingIds = new Set(holdings.map((h) => h.id));
  const pointsByCurrency: Record<string, PerformanceHistoryPoint[]> = {};

  const computeNetContributionsUpToDate = (currency: string, upToDate: string): number | null => {
    const matching = capitalFlows.filter(
      (f) => f.currency.toUpperCase() === currency && f.activityDate <= upToDate
    );
    if (matching.length === 0) return null;
    let total = 0;
    for (const flow of matching) {
      if (flow.activityType === 'contribution') {
        total = roundCurrencyAmount(addDecimal(total, flow.grossAmount), currency);
      } else {
        total = roundCurrencyAmount(subtractDecimal(total, flow.grossAmount), currency);
      }
    }
    return total;
  };

  for (const snap of snapshots) {
    const currency = snap.currency.toUpperCase();
    if (!pointsByCurrency[currency]) {
      pointsByCurrency[currency] = [];
    }

    if (snap.scope === 'portfolio' || snap.scope === 'platform' || (snap.scope === 'holding' && snap.holdingId && holdingIds.has(snap.holdingId))) {
      const costBasis = snap.costBasis !== undefined ? snap.costBasis : null;
      const unrealizedPnlOnSnapshot =
        costBasis !== null
          ? roundCurrencyAmount(subtractDecimal(snap.marketValue, costBasis), currency)
          : null;

      pointsByCurrency[currency].push({
        date: snap.valuationDate,
        snapshotId: snap.id,
        scope: snap.scope,
        currency,
        portfolioValue: snap.marketValue,
        costBasis,
        cumulativeNetContributions: computeNetContributionsUpToDate(currency, snap.valuationDate),
        unrealizedPnlOnSnapshot,
        notes: snap.notes,
      });
    }
  }

  return {
    pointsByCurrency,
    snapshots: [...snapshots].sort(
      (a, b) =>
        b.valuationDate.localeCompare(a.valuationDate) || b.createdAt.localeCompare(a.createdAt)
    ),
    returnMethodologyNote:
      'Simple Return on Net Contributions = (Total Investment Gain / Net Contributions) × 100 when Net Contributions > 0; Unrealized Return = (Unrealized P/L / Remaining Cost Basis) × 100. Annualized returns are intentionally omitted unless full dated cashflow history is present.',
  };
}
