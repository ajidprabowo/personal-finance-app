import { roundCurrencyAmount } from '@/lib/currency';
import { addDecimal, subtractDecimal } from '@/lib/precision';
import {
  accountsRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  transactionsRepository,
} from '@/repositories';
import type {
  Account,
  Holding,
  InvestmentActivity,
  RecordOrigin,
  Transaction,
} from '@/types/entities';

export interface AccountBalanceItem {
  account: Account;
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  totalTransfersIn: number;
  totalTransfersOut: number;
  totalInvestmentInflows: number;
  totalInvestmentOutflows: number;
  currentBalance: number;
  transactionCount: number;
  excludedFromConsolidatedTotal: boolean;
  exclusionReason?: string;
}

export interface CurrencyBalanceTotals {
  currency: string;
  liquidCashBalance: number;
  investmentPoolBalance: number;
  platformCashBalance: number;
  totalAccountBalance: number;
  includedAccountCount: number;
  excludedAccountCount: number;
}

export interface AccountBalancesSnapshot {
  items: AccountBalanceItem[];
  totalsByCurrency: Record<string, CurrencyBalanceTotals>;
  warnings: string[];
}

export interface CurrencyNetWorthTotals {
  currency: string;
  liquidCashBalance: number;
  investmentPoolBalance: number;
  platformCashBalance: number;
  holdingsMarketValue: number;
  totalInvestmentValue: number;
  totalNetWorth: number;
}

export interface NetWorthSnapshot {
  balances: AccountBalancesSnapshot;
  byCurrency: Record<string, CurrencyNetWorthTotals>;
}

/**
 * Pure deterministic balance calculation engine.
 * Derives current balances strictly from account opening balances, posted transactions,
 * and investment cash events (buy/sell/dividend/interest/fee).
 * Prevents double counting across transfers, linked investment transfers, and Investment Pool / Platform Cash hierarchies.
 */
export function calculateAccountBalances(
  accounts: Account[],
  transactions: Transaction[],
  investmentActivities: InvestmentActivity[] = []
): AccountBalancesSnapshot {
  const warnings: string[] = [];

  const statsMap = new Map<
    string,
    {
      totalIncome: number;
      totalExpense: number;
      totalTransfersIn: number;
      totalTransfersOut: number;
      totalInvestmentInflows: number;
      totalInvestmentOutflows: number;
      transactionCount: number;
    }
  >();

  for (const acc of accounts) {
    statsMap.set(acc.id, {
      totalIncome: 0,
      totalExpense: 0,
      totalTransfersIn: 0,
      totalTransfersOut: 0,
      totalInvestmentInflows: 0,
      totalInvestmentOutflows: 0,
      transactionCount: 0,
    });
  }

  const seenTransferGroups = new Set<string>();

  for (const tx of transactions) {
    const amount = Number.isFinite(tx.amount) ? Math.abs(tx.amount) : 0;
    if (amount <= 0) continue;

    if (tx.type === 'income') {
      const target = statsMap.get(tx.accountId);
      if (target) {
        target.totalIncome = roundCurrencyAmount(
          addDecimal(target.totalIncome, amount),
          tx.currency
        );
        target.transactionCount += 1;
      }
      continue;
    }

    if (tx.type === 'expense') {
      const target = statsMap.get(tx.accountId);
      if (target) {
        target.totalExpense = roundCurrencyAmount(
          addDecimal(target.totalExpense, amount),
          tx.currency
        );
        target.transactionCount += 1;
      }
      continue;
    }

    if (tx.type === 'transfer') {
      if (!tx.transferGroupId) {
        warnings.push(`Transfer "${tx.id}" is missing transferGroupId.`);
      } else {
        if (seenTransferGroups.has(tx.transferGroupId)) {
          continue;
        }
        seenTransferGroups.add(tx.transferGroupId);
      }

      if (!tx.toAccountId || tx.toAccountId === tx.accountId) {
        warnings.push(`Transfer "${tx.id}" has an invalid destination account.`);
        continue;
      }

      const source = statsMap.get(tx.accountId);
      const dest = statsMap.get(tx.toAccountId);

      if (source && dest && source !== dest) {
        source.totalTransfersOut = roundCurrencyAmount(
          addDecimal(source.totalTransfersOut, amount),
          tx.currency
        );
        source.transactionCount += 1;

        dest.totalTransfersIn = roundCurrencyAmount(
          addDecimal(dest.totalTransfersIn, amount),
          tx.currency
        );
        dest.transactionCount += 1;
      }
    }
  }

  // Apply investment cash settlements (buy, sell, dividend, interest, standalone fee).
  // Contribution / withdrawal / platform_transfer are already reflected via their linkedTransactionId transfer rows.
  for (const act of investmentActivities) {
    if (!act.accountId) continue;
    const target = statsMap.get(act.accountId);
    if (!target) continue;

    const gross = Number.isFinite(act.grossAmount) ? Math.abs(act.grossAmount) : 0;
    const fee = Number.isFinite(act.feeAmount) ? Math.abs(act.feeAmount) : 0;

    if (act.activityType === 'buy') {
      const settlementCurrency = act.settlementCurrency ?? act.currency;
      const totalOutflow = roundCurrencyAmount(
        act.settlementAmount ?? addDecimal(gross, fee), settlementCurrency
      );
      if (totalOutflow > 0) {
        target.totalInvestmentOutflows = roundCurrencyAmount(
          addDecimal(target.totalInvestmentOutflows, totalOutflow),
          settlementCurrency
        );
        target.transactionCount += 1;
      }
    } else if (act.activityType === 'sell' || act.activityType === 'partial_sell') {
      const settlementCurrency = act.settlementCurrency ?? act.currency;
      const netProceeds = roundCurrencyAmount(
        act.settlementAmount ?? Math.max(0, subtractDecimal(gross, fee)), settlementCurrency
      );
      if (netProceeds > 0) {
        target.totalInvestmentInflows = roundCurrencyAmount(
          addDecimal(target.totalInvestmentInflows, netProceeds),
          settlementCurrency
        );
      }
      target.transactionCount += 1;
    } else if (act.activityType === 'dividend' || act.activityType === 'interest') {
      const netIncome = roundCurrencyAmount(Math.max(0, subtractDecimal(gross, fee)), act.currency);
      if (netIncome > 0) {
        target.totalInvestmentInflows = roundCurrencyAmount(
          addDecimal(target.totalInvestmentInflows, netIncome),
          act.currency
        );
        target.transactionCount += 1;
      }
    } else if (act.activityType === 'fee') {
      const feeOutflow = roundCurrencyAmount(fee > 0 ? fee : gross, act.currency);
      if (feeOutflow > 0) {
        target.totalInvestmentOutflows = roundCurrencyAmount(
          addDecimal(target.totalInvestmentOutflows, feeOutflow),
          act.currency
        );
        target.transactionCount += 1;
      }
    }
  }

  // Detect platforms that already have an active Investment Pool account so linked Platform Cash
  // mirrors on the same platformId are never double-counted in consolidated totals.
  const activePoolPlatformIds = new Set(
    accounts
      .filter(
        (acc) =>
          !acc.isArchived &&
          acc.platformId &&
          (acc.type === 'investment_pool' || acc.isInvestmentPool === true)
      )
      .map((acc) => acc.platformId as string)
  );

  const items: AccountBalanceItem[] = accounts.map((acc) => {
    const stat = statsMap.get(acc.id)!;
    const openingBalance = roundCurrencyAmount(acc.initialBalance || 0, acc.currency);
    const inflows = addDecimal(
      addDecimal(openingBalance, stat.totalIncome),
      addDecimal(stat.totalTransfersIn, stat.totalInvestmentInflows)
    );
    const outflows = addDecimal(
      stat.totalExpense,
      addDecimal(stat.totalTransfersOut, stat.totalInvestmentOutflows)
    );
    const currentBalance = roundCurrencyAmount(subtractDecimal(inflows, outflows), acc.currency);

    const isMirroredPlatformCash =
      acc.type === 'investment_cash' &&
      Boolean(acc.platformId && activePoolPlatformIds.has(acc.platformId));

    return {
      account: acc,
      openingBalance,
      totalIncome: stat.totalIncome,
      totalExpense: stat.totalExpense,
      totalTransfersIn: stat.totalTransfersIn,
      totalTransfersOut: stat.totalTransfersOut,
      totalInvestmentInflows: stat.totalInvestmentInflows,
      totalInvestmentOutflows: stat.totalInvestmentOutflows,
      currentBalance,
      transactionCount: stat.transactionCount,
      excludedFromConsolidatedTotal: isMirroredPlatformCash,
      exclusionReason: isMirroredPlatformCash
        ? 'Excluded from consolidated total because parent Investment Pool on this platform is active.'
        : undefined,
    };
  });

  // Group totals strictly per currency (never combine disparate currencies without FX)
  const totalsByCurrency: Record<string, CurrencyBalanceTotals> = {};

  for (const item of items) {
    const currency = item.account.currency.toUpperCase();
    if (!totalsByCurrency[currency]) {
      totalsByCurrency[currency] = {
        currency,
        liquidCashBalance: 0,
        investmentPoolBalance: 0,
        platformCashBalance: 0,
        totalAccountBalance: 0,
        includedAccountCount: 0,
        excludedAccountCount: 0,
      };
    }

    const bucket = totalsByCurrency[currency];
    if (item.excludedFromConsolidatedTotal) {
      bucket.excludedAccountCount += 1;
      continue;
    }

    bucket.includedAccountCount += 1;
    bucket.totalAccountBalance = roundCurrencyAmount(
      addDecimal(bucket.totalAccountBalance, item.currentBalance),
      currency
    );

    if (item.account.type === 'investment_pool' || item.account.isInvestmentPool) {
      bucket.investmentPoolBalance = roundCurrencyAmount(
        addDecimal(bucket.investmentPoolBalance, item.currentBalance),
        currency
      );
    } else if (item.account.type === 'investment_cash') {
      bucket.platformCashBalance = roundCurrencyAmount(
        addDecimal(bucket.platformCashBalance, item.currentBalance),
        currency
      );
    } else {
      bucket.liquidCashBalance = roundCurrencyAmount(
        addDecimal(bucket.liquidCashBalance, item.currentBalance),
        currency
      );
    }
  }

  return {
    items,
    totalsByCurrency,
    warnings,
  };
}

export function resolveHoldingMarketValue(holding: Holding): number {
  const qty = Number.isFinite(holding.quantity) ? Math.max(0, holding.quantity) : 0;
  if (qty <= 0) return 0;
  if (holding.priceRecorded !== true) return 0;
  if (typeof holding.currentPrice === 'number' && Number.isFinite(holding.currentPrice)) {
    return roundCurrencyAmount(qty * Math.max(0, holding.currentPrice), holding.currency);
  }
  return 0;
}

/**
 * Single unified Net Worth calculation per currency:
 * Net Worth = Non-Investment Liquid Cash + Investment Pool + Platform Cash + Holdings Market Value
 */
export function calculateConsolidatedNetWorth(
  accounts: Account[],
  transactions: Transaction[],
  investmentActivities: InvestmentActivity[],
  holdings: Holding[]
): NetWorthSnapshot {
  const balances = calculateAccountBalances(accounts, transactions, investmentActivities);
  const byCurrency: Record<string, CurrencyNetWorthTotals> = {};

  const ensureBucket = (currency: string): CurrencyNetWorthTotals => {
    const code = currency.toUpperCase();
    if (!byCurrency[code]) {
      byCurrency[code] = {
        currency: code,
        liquidCashBalance: 0,
        investmentPoolBalance: 0,
        platformCashBalance: 0,
        holdingsMarketValue: 0,
        totalInvestmentValue: 0,
        totalNetWorth: 0,
      };
    }
    return byCurrency[code];
  };

  for (const tot of Object.values(balances.totalsByCurrency)) {
    const bucket = ensureBucket(tot.currency);
    bucket.liquidCashBalance = tot.liquidCashBalance;
    bucket.investmentPoolBalance = tot.investmentPoolBalance;
    bucket.platformCashBalance = tot.platformCashBalance;
  }

  for (const holding of holdings) {
    const marketValue = resolveHoldingMarketValue(holding);
    if (marketValue <= 0) continue;
    const bucket = ensureBucket(holding.currency);
    bucket.holdingsMarketValue = roundCurrencyAmount(
      addDecimal(bucket.holdingsMarketValue, marketValue),
      bucket.currency
    );
  }

  for (const bucket of Object.values(byCurrency)) {
    bucket.totalInvestmentValue = roundCurrencyAmount(
      addDecimal(
        addDecimal(bucket.investmentPoolBalance, bucket.platformCashBalance),
        bucket.holdingsMarketValue
      ),
      bucket.currency
    );
    bucket.totalNetWorth = roundCurrencyAmount(
      addDecimal(bucket.liquidCashBalance, bucket.totalInvestmentValue),
      bucket.currency
    );
  }

  return {
    balances,
    byCurrency,
  };
}

export async function getAccountBalancesSnapshot(options?: {
  recordOrigin?: RecordOrigin;
}): Promise<AccountBalancesSnapshot> {
  const origin = options?.recordOrigin ?? 'user';
  const [accounts, transactions, activities] = await Promise.all([
    origin === 'test' ? accountsRepository.getTestRecords() : accountsRepository.getUserRecords(),
    origin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
  ]);

  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));
  return calculateAccountBalances(sortedAccounts, transactions, activities);
}

export async function getNetWorthSnapshot(options?: {
  recordOrigin?: RecordOrigin;
}): Promise<NetWorthSnapshot> {
  const origin = options?.recordOrigin ?? 'user';
  const [accounts, transactions, activities, holdings] = await Promise.all([
    origin === 'test' ? accountsRepository.getTestRecords() : accountsRepository.getUserRecords(),
    origin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
  ]);

  return calculateConsolidatedNetWorth(accounts, transactions, activities, holdings);
}

