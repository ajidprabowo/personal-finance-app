import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { isValidDateString, nowIso, todayDateString } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import { addDecimal, subtractDecimal } from '@/lib/precision';
import {
  accountsRepository,
  investmentActivitiesRepository,
  investmentPlatformsRepository,
  transactionsRepository,
} from '@/repositories';
import {
  getAccountBalancesSnapshot,
  type AccountBalanceItem,
} from '@/services/account-balance.service';
import type {
  Account,
  InvestmentActivity,
  RecordOrigin,
  Transaction,
} from '@/types/entities';

export interface PoolTransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  date?: string;
  description?: string;
  notes?: string;
}

export interface PoolPlatformTransferInput {
  poolAccountId: string;
  platformId: string;
  direction?: 'pool_to_platform' | 'platform_to_pool';
  amount: number;
  date?: string;
  description?: string;
  notes?: string;
}

export interface CurrencyPoolTotals {
  currency: string;
  poolBalance: number;
  grossContributions: number;
  totalWithdrawals: number;
  netContributions: number;
  totalTransferredToPlatforms: number;
}

export interface InvestmentPoolSummary {
  poolAccounts: AccountBalanceItem[];
  sourceMainAccounts: AccountBalanceItem[];
  totalsByCurrency: Record<string, CurrencyPoolTotals>;
  recentPoolActivities: InvestmentActivity[];
}

export async function ensureInvestmentPoolAccount(
  currency: string = APP_CONFIG.defaultCurrency,
  options?: { recordOrigin?: RecordOrigin }
): Promise<Account> {
  const origin = options?.recordOrigin ?? 'user';
  const code = currency.toUpperCase();
  const accounts =
    origin === 'test'
      ? await accountsRepository.getTestRecords()
      : await accountsRepository.getUserRecords();

  const existing = accounts.find(
    (a) =>
      !a.isArchived &&
      !a.platformId &&
      (a.type === 'investment_pool' || a.isInvestmentPool === true) &&
      a.currency.toUpperCase() === code
  );
  if (existing) return existing;

  const isDefaultIdr = origin === 'user' && code === APP_CONFIG.defaultCurrency;
  return accountsRepository.create({
    id: isDefaultIdr ? APP_CONFIG.defaultInvestmentPoolAccountId : undefined,
    name: code === APP_CONFIG.defaultCurrency ? 'Investment Pool' : `Investment Pool (${code})`,
    type: 'investment_pool',
    currency: code,
    initialBalance: 0,
    isInvestmentPool: true,
    isArchived: false,
    notes: 'Unallocated investment capital reserve.',
    isTestData: origin === 'test',
    recordOrigin: origin,
  });
}

function assertValidPoolTransferBase(amount: number, date: string, currency: string): number {
  const rounded = roundCurrencyAmount(Number(amount), currency);
  if (!Number.isFinite(amount) || rounded <= 0) {
    throw new ValidationError('Transfer amount must be greater than zero.');
  }
  if (!isValidDateString(date)) {
    throw new ValidationError('Date must be a valid YYYY-MM-DD calendar date.');
  }
  return rounded;
}

/**
 * Main Balance -> Investment Pool (Contribution).
 * Internal allocation transfer: Main Balance decreases, Investment Pool increases, Total Net Worth unchanged.
 */
export async function contributeToInvestmentPool(
  input: PoolTransferInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{ activity: InvestmentActivity; transaction: Transaction }> {
  const origin = options?.recordOrigin ?? 'user';
  const date = input.date || todayDateString();
  const db = await ensureDatabaseOpen();

  return db.transaction(
    'rw',
    [db.accounts, db.transactions, db.investmentActivities],
    async () => {
      const [source, dest] = await Promise.all([
        db.accounts.get(input.sourceAccountId),
        db.accounts.get(input.destinationAccountId),
      ]);

      if (!source || source.recordOrigin !== origin || source.isArchived) {
        throw new ValidationError('Source account must be an active local account.');
      }
      if (source.type === 'investment_pool' || source.type === 'investment_cash') {
        throw new ValidationError(
          'Contributions must originate from a non-investment account (Bank, Cash, or E-Wallet).'
        );
      }
      if (!dest || dest.recordOrigin !== origin || dest.isArchived) {
        throw new ValidationError('Destination Investment Pool account must be active.');
      }
      if (dest.type !== 'investment_pool' && !dest.isInvestmentPool) {
        throw new ValidationError('Destination account must be an Investment Pool account.');
      }
      if (source.currency !== dest.currency) {
        throw new ValidationError(
          `Currency mismatch (${source.currency} -> ${dest.currency}). Select an Investment Pool in ${source.currency}.`
        );
      }

      const amount = assertValidPoolTransferBase(input.amount, date, source.currency);
      const timestamp = nowIso();
      const transferGroupId = crypto.randomUUID();
      const transactionId = crypto.randomUUID();
      const activityId = crypto.randomUUID();
      const desc =
        input.description?.trim() || `Contribution: ${source.name} -> ${dest.name}`;

      const txRecord: Transaction = {
        id: transactionId,
        accountId: source.id,
        toAccountId: dest.id,
        transferGroupId,
        type: 'transfer',
        amount,
        currency: source.currency,
        date,
        description: desc,
        status: 'posted',
        relatedInvestmentActivityId: activityId,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const actRecord: InvestmentActivity = {
        id: activityId,
        platformId: '',
        accountId: source.id,
        toAccountId: dest.id,
        linkedTransactionId: transactionId,
        transferGroupId,
        activityType: 'contribution',
        grossAmount: amount,
        feeAmount: 0,
        netAmount: amount,
        currency: source.currency,
        activityDate: date,
        description: desc,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.transactions.add(txRecord);
      await db.investmentActivities.add(actRecord);

      return { activity: actRecord, transaction: txRecord };
    }
  );
}

/**
 * Investment Pool -> Main Balance (Withdrawal).
 * Internal allocation transfer: Investment Pool decreases, Main Balance increases, Total Net Worth unchanged.
 */
export async function withdrawFromInvestmentPool(
  input: PoolTransferInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{ activity: InvestmentActivity; transaction: Transaction }> {
  const origin = options?.recordOrigin ?? 'user';
  const date = input.date || todayDateString();
  const db = await ensureDatabaseOpen();

  return db.transaction(
    'rw',
    [db.accounts, db.transactions, db.investmentActivities],
    async () => {
      const [source, dest] = await Promise.all([
        db.accounts.get(input.sourceAccountId),
        db.accounts.get(input.destinationAccountId),
      ]);

      if (!source || source.recordOrigin !== origin || source.isArchived) {
        throw new ValidationError('Source Investment Pool account must be active.');
      }
      if (source.type !== 'investment_pool' && !source.isInvestmentPool) {
        throw new ValidationError('Withdrawals must originate from an Investment Pool account.');
      }
      if (!dest || dest.recordOrigin !== origin || dest.isArchived) {
        throw new ValidationError('Destination account must be active.');
      }
      if (dest.type === 'investment_pool' || dest.type === 'investment_cash') {
        throw new ValidationError(
          'Withdrawals must go to a non-investment account (Bank, Cash, or E-Wallet).'
        );
      }
      if (source.currency !== dest.currency) {
        throw new ValidationError(
          `Currency mismatch (${source.currency} -> ${dest.currency}). Destination account must match ${source.currency}.`
        );
      }

      const amount = assertValidPoolTransferBase(input.amount, date, source.currency);
      const timestamp = nowIso();
      const transferGroupId = crypto.randomUUID();
      const transactionId = crypto.randomUUID();
      const activityId = crypto.randomUUID();
      const desc =
        input.description?.trim() || `Withdrawal: ${source.name} -> ${dest.name}`;

      const txRecord: Transaction = {
        id: transactionId,
        accountId: source.id,
        toAccountId: dest.id,
        transferGroupId,
        type: 'transfer',
        amount,
        currency: source.currency,
        date,
        description: desc,
        status: 'posted',
        relatedInvestmentActivityId: activityId,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const actRecord: InvestmentActivity = {
        id: activityId,
        platformId: '',
        accountId: source.id,
        toAccountId: dest.id,
        linkedTransactionId: transactionId,
        transferGroupId,
        activityType: 'withdrawal',
        grossAmount: amount,
        feeAmount: 0,
        netAmount: amount,
        currency: source.currency,
        activityDate: date,
        description: desc,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.transactions.add(txRecord);
      await db.investmentActivities.add(actRecord);

      return { activity: actRecord, transaction: txRecord };
    }
  );
}

/**
 * Investment Pool <-> Platform Cash (Platform Transfer).
 * Internal transfer: Total investment value and net worth remain unchanged.
 */
export async function transferBetweenPoolAndPlatform(
  input: PoolPlatformTransferInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{ activity: InvestmentActivity; transaction: Transaction }> {
  const origin = options?.recordOrigin ?? 'user';
  const date = input.date || todayDateString();
  const direction = input.direction ?? 'pool_to_platform';
  const db = await ensureDatabaseOpen();

  return db.transaction(
    'rw',
    [db.accounts, db.investmentPlatforms, db.transactions, db.investmentActivities],
    async () => {
      const [poolAccount, platform] = await Promise.all([
        db.accounts.get(input.poolAccountId),
        db.investmentPlatforms.get(input.platformId),
      ]);

      if (!poolAccount || poolAccount.recordOrigin !== origin || poolAccount.isArchived) {
        throw new ValidationError('Investment Pool account must be active.');
      }
      if (poolAccount.type !== 'investment_pool' && !poolAccount.isInvestmentPool) {
        throw new ValidationError('Selected pool account is not an Investment Pool.');
      }
      if (!platform || platform.recordOrigin !== origin || platform.isArchived) {
        throw new ValidationError('Selected investment platform is disabled or not found.');
      }
      if (!platform.cashAccountId) {
        throw new ValidationError(`Platform "${platform.name}" does not have a linked cash account.`);
      }

      const platformCashAccount = await db.accounts.get(platform.cashAccountId);
      if (!platformCashAccount || platformCashAccount.isArchived) {
        throw new ValidationError(`Cash account for "${platform.name}" is inactive.`);
      }

      const sourceAccount = direction === 'pool_to_platform' ? poolAccount : platformCashAccount;
      const destAccount = direction === 'pool_to_platform' ? platformCashAccount : poolAccount;

      if (sourceAccount.currency !== destAccount.currency) {
        throw new ValidationError(
          `Currency mismatch (${sourceAccount.currency} -> ${destAccount.currency}). Create or select an Investment Pool in ${platformCashAccount.currency} first.`
        );
      }

      const amount = assertValidPoolTransferBase(input.amount, date, sourceAccount.currency);
      const timestamp = nowIso();
      const transferGroupId = crypto.randomUUID();
      const transactionId = crypto.randomUUID();
      const activityId = crypto.randomUUID();
      const desc =
        input.description?.trim() ||
        `Platform Transfer: ${sourceAccount.name} -> ${destAccount.name}`;

      const txRecord: Transaction = {
        id: transactionId,
        accountId: sourceAccount.id,
        toAccountId: destAccount.id,
        transferGroupId,
        type: 'transfer',
        amount,
        currency: sourceAccount.currency,
        date,
        description: desc,
        status: 'posted',
        relatedInvestmentActivityId: activityId,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const actRecord: InvestmentActivity = {
        id: activityId,
        platformId: platform.id,
        accountId: sourceAccount.id,
        toAccountId: destAccount.id,
        linkedTransactionId: transactionId,
        transferGroupId,
        activityType: 'platform_transfer',
        grossAmount: amount,
        feeAmount: 0,
        netAmount: amount,
        currency: sourceAccount.currency,
        activityDate: date,
        description: desc,
        notes: input.notes?.trim() || undefined,
        isTestData: origin === 'test',
        recordOrigin: origin,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.transactions.add(txRecord);
      await db.investmentActivities.add(actRecord);

      return { activity: actRecord, transaction: txRecord };
    }
  );
}

export async function getInvestmentPoolSummary(options?: {
  recordOrigin?: RecordOrigin;
}): Promise<InvestmentPoolSummary> {
  const origin = options?.recordOrigin ?? 'user';
  const [balances, activities, platforms] = await Promise.all([
    getAccountBalancesSnapshot({ recordOrigin: origin }),
    origin === 'test'
      ? investmentActivitiesRepository.getTestRecords()
      : investmentActivitiesRepository.getUserRecords(),
    origin === 'test'
      ? investmentPlatformsRepository.getTestRecords()
      : investmentPlatformsRepository.getUserRecords(),
  ]);

  const poolAccounts = balances.items.filter(
    (item) =>
      !item.account.isArchived &&
      (item.account.type === 'investment_pool' || item.account.isInvestmentPool === true)
  );

  const sourceMainAccounts = balances.items.filter(
    (item) =>
      !item.account.isArchived &&
      item.account.type !== 'investment_pool' &&
      item.account.type !== 'investment_cash' &&
      !item.account.isInvestmentPool
  );

  const totalsByCurrency: Record<string, CurrencyPoolTotals> = {};
  const ensureBucket = (currency: string): CurrencyPoolTotals => {
    const code = currency.toUpperCase();
    if (!totalsByCurrency[code]) {
      totalsByCurrency[code] = {
        currency: code,
        poolBalance: 0,
        grossContributions: 0,
        totalWithdrawals: 0,
        netContributions: 0,
        totalTransferredToPlatforms: 0,
      };
    }
    return totalsByCurrency[code];
  };

  for (const item of poolAccounts) {
    const bucket = ensureBucket(item.account.currency);
    bucket.poolBalance = roundCurrencyAmount(
      addDecimal(bucket.poolBalance, item.currentBalance),
      bucket.currency
    );
  }

  const platformCashIds = new Set(platforms.map((p) => p.cashAccountId).filter(Boolean));
  const poolAccountIds = new Set(poolAccounts.map((p) => p.account.id));

  for (const act of activities) {
    const bucket = ensureBucket(act.currency);
    if (act.activityType === 'contribution') {
      bucket.grossContributions = roundCurrencyAmount(
        addDecimal(bucket.grossContributions, act.grossAmount),
        bucket.currency
      );
    } else if (act.activityType === 'withdrawal') {
      bucket.totalWithdrawals = roundCurrencyAmount(
        addDecimal(bucket.totalWithdrawals, act.grossAmount),
        bucket.currency
      );
    } else if (
      act.activityType === 'platform_transfer' &&
      act.accountId &&
      poolAccountIds.has(act.accountId) &&
      act.toAccountId &&
      platformCashIds.has(act.toAccountId)
    ) {
      bucket.totalTransferredToPlatforms = roundCurrencyAmount(
        addDecimal(bucket.totalTransferredToPlatforms, act.grossAmount),
        bucket.currency
      );
    }
  }

  for (const bucket of Object.values(totalsByCurrency)) {
    bucket.netContributions = roundCurrencyAmount(
      subtractDecimal(bucket.grossContributions, bucket.totalWithdrawals),
      bucket.currency
    );
  }

  const recentPoolActivities = activities
    .filter(
      (a) =>
        a.activityType === 'contribution' ||
        a.activityType === 'withdrawal' ||
        a.activityType === 'platform_transfer'
    )
    .sort(
      (a, b) =>
        b.activityDate.localeCompare(a.activityDate) || b.createdAt.localeCompare(a.createdAt)
    );

  return {
    poolAccounts,
    sourceMainAccounts,
    totalsByCurrency,
    recentPoolActivities,
  };
}

export async function listPoolAndMainAccounts(options?: {
  recordOrigin?: RecordOrigin;
}): Promise<{
  poolAccounts: Account[];
  mainAccounts: Account[];
}> {
  const origin = options?.recordOrigin ?? 'user';
  const accounts =
    origin === 'test'
      ? await accountsRepository.getTestRecords()
      : await accountsRepository.getUserRecords();

  return {
    poolAccounts: accounts.filter(
      (a) => !a.isArchived && (a.type === 'investment_pool' || a.isInvestmentPool === true)
    ),
    mainAccounts: accounts.filter(
      (a) =>
        !a.isArchived &&
        a.type !== 'investment_pool' &&
        a.type !== 'investment_cash' &&
        !a.isInvestmentPool
    ),
  };
}
