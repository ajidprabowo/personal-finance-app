import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { ValidationError, SafetyGuardError } from '@/lib/errors';
import { formatDisplayDate, getPeriodDateRange, getTodayInTimezone } from '@/lib/dates';
import { accountsRepository, categoriesRepository, transactionsRepository } from '@/repositories';
import {
  calculateAccountBalances,
  getAccountBalancesSnapshot,
} from '@/services/account-balance.service';
import { initializeApplication } from '@/services/bootstrap.service';
import {
  calculateFinancialSummary,
  getFinancialSummaryForPeriod,
} from '@/services/financial-summary.service';
import {
  createCustomCategory,
  createUserAccount,
  deleteCustomCategory,
  deleteUserAccountSafely,
  updateUserAccount,
} from '@/services/settings.service';
import {
  createTransaction,
  deleteTransaction,
  listTransactionsFiltered,
  updateTransaction,
} from '@/services/transaction.service';
import type { Account, Transaction } from '@/types/entities';

async function resetLocalDatabaseForTest(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  await initializeApplication();
}

describe('Stage 3 — Transaction Management & Financial Engine', () => {
  beforeEach(async () => {
    resetDatabaseInstance();
    await resetLocalDatabaseForTest();
  });

  it('initializes schema v6 with persistent installation ID and default income & expense categories', async () => {
    const first = await initializeApplication();
    const second = await initializeApplication();

    assert.equal(first.schemaVersion, APP_CONFIG.currentSchemaVersion);
    assert.equal(second.installation.installationId, first.installation.installationId);

    const categories = await categoriesRepository.getUserRecords();
    const incomeCats = categories.filter((c) => c.kind === 'income');
    const expenseCats = categories.filter((c) => c.kind === 'expense');

    assert.ok(incomeCats.length >= 5, 'Default income categories should be seeded');
    assert.ok(expenseCats.length >= 6, 'Default expense categories should be seeded');
  });

  it('validates and processes income, expense, and internal transfer balances without double counting', async () => {
    const bank = await createUserAccount({
      name: 'BCA Main',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const ewallet = await createUserAccount({
      name: 'GoPay',
      type: 'ewallet',
      currency: 'IDR',
      initialBalance: 2_000_000,
    });
    const cash = await createUserAccount({
      name: 'Cash Wallet',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 500_000,
    });

    const categories = await categoriesRepository.getUserRecords();
    const salaryCat = categories.find((c) => c.kind === 'income');
    const foodCat = categories.find((c) => c.kind === 'expense');
    assert.ok(salaryCat && foodCat);

    // 1. Income +5,000,000 -> Bank becomes 15,000,000
    const incomeTx = await createTransaction({
      type: 'income',
      amount: 5_000_000,
      date: '2026-11-05',
      accountId: bank.id,
      categoryId: salaryCat.id,
      description: 'Monthly Salary',
    });

    // 2. Expense -2,500,000 -> Bank becomes 12,500,000
    const expenseTx = await createTransaction({
      type: 'expense',
      amount: 2_500_000,
      date: '2026-11-10',
      accountId: bank.id,
      categoryId: foodCat.id,
      description: 'Household & Groceries',
    });

    // 3. Internal Transfer 1,000,000 Bank -> E-Wallet
    // Bank = 11,500,000; E-Wallet = 3,000,000; Cash = 500,000; Total = 15,000,000
    const transferTx = await createTransaction({
      type: 'transfer',
      amount: 1_000_000,
      date: '2026-11-12',
      accountId: bank.id,
      toAccountId: ewallet.id,
      description: 'Top up GoPay',
    });

    assert.ok(incomeTx.id);
    assert.ok(expenseTx.id);
    assert.ok(transferTx.transferGroupId);

    const balances = await getAccountBalancesSnapshot({ recordOrigin: 'user' });
    const byId = new Map(balances.items.map((i) => [i.account.id, i]));

    assert.equal(byId.get(bank.id)?.currentBalance, 11_500_000);
    assert.equal(byId.get(ewallet.id)?.currentBalance, 3_000_000);
    assert.equal(byId.get(cash.id)?.currentBalance, 500_000);
    assert.equal(balances.totalsByCurrency.IDR.totalAccountBalance, 15_000_000);

    const summary = await getFinancialSummaryForPeriod({
      preset: 'custom',
      customStart: '2026-11-01',
      customEnd: '2026-11-30',
      primaryCurrency: 'IDR',
    });

    assert.equal(summary.totalIncome, 5_000_000);
    assert.equal(summary.totalExpenses, 2_500_000);
    assert.equal(summary.netCashFlow, 2_500_000);
    assert.equal(summary.transactionCount, 3);
    assert.equal(summary.incomeCount, 1);
    assert.equal(summary.expenseCount, 1);
    assert.equal(summary.transferCount, 1);
  });

  it('rejects invalid amounts, same-account transfers, cross-currency transfers, and duplicate transfer groups', async () => {
    const idrBank = await createUserAccount({
      name: 'Mandiri IDR',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const usdBank = await createUserAccount({
      name: 'Wise USD',
      type: 'bank',
      currency: 'USD',
      initialBalance: 500,
    });

    const categories = await categoriesRepository.getUserRecords();
    const incomeCat = categories.find((c) => c.kind === 'income')!;
    const expenseCat = categories.find((c) => c.kind === 'expense')!;

    await assert.rejects(
      () =>
        createTransaction({
          type: 'income',
          amount: 0,
          date: '2026-11-15',
          accountId: idrBank.id,
          categoryId: incomeCat.id,
          description: 'Zero income',
        }),
      ValidationError
    );

    await assert.rejects(
      () =>
        createTransaction({
          type: 'expense',
          amount: -50_000,
          date: '2026-11-15',
          accountId: idrBank.id,
          categoryId: expenseCat.id,
          description: 'Negative expense',
        }),
      ValidationError
    );

    await assert.rejects(
      () =>
        createTransaction({
          type: 'transfer',
          amount: 100_000,
          date: '2026-11-15',
          accountId: idrBank.id,
          toAccountId: idrBank.id,
        }),
      ValidationError
    );

    await assert.rejects(
      () =>
        createTransaction({
          type: 'transfer',
          amount: 100_000,
          date: '2026-11-15',
          accountId: idrBank.id,
          toAccountId: usdBank.id,
        }),
      ValidationError
    );

    const validTransfer = await createTransaction({
      type: 'transfer',
      amount: 250_000,
      date: '2026-11-15',
      accountId: idrBank.id,
      toAccountId: (
        await createUserAccount({
          name: 'OVO IDR',
          type: 'ewallet',
          currency: 'IDR',
          initialBalance: 0,
        })
      ).id,
      transferGroupId: 'fixed-transfer-group-1',
    });

    assert.equal(validTransfer.transferGroupId, 'fixed-transfer-group-1');

    // Duplicate transferGroupId must be rejected
    await assert.rejects(
      () =>
        createTransaction({
          type: 'transfer',
          amount: 100_000,
          date: '2026-11-16',
          accountId: idrBank.id,
          toAccountId: validTransfer.toAccountId,
          transferGroupId: 'fixed-transfer-group-1',
        }),
      ValidationError
    );
  });

  it('updates and deletes income, expense, and transfer transactions atomically', async () => {
    const bank = await createUserAccount({
      name: 'Bank A',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 5_000_000,
    });
    const cash = await createUserAccount({
      name: 'Cash B',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const wallet = await createUserAccount({
      name: 'Wallet C',
      type: 'ewallet',
      currency: 'IDR',
      initialBalance: 500_000,
    });

    const categories = await categoriesRepository.getUserRecords();
    const incomeCat = categories.find((c) => c.kind === 'income')!;
    const expenseCat = categories.find((c) => c.kind === 'expense')!;

    const inc = await createTransaction({
      type: 'income',
      amount: 2_000_000,
      date: '2026-11-02',
      accountId: bank.id,
      categoryId: incomeCat.id,
      description: 'Consulting',
    });

    const exp = await createTransaction({
      type: 'expense',
      amount: 300_000,
      date: '2026-11-03',
      accountId: bank.id,
      categoryId: expenseCat.id,
      description: 'Internet Bill',
    });

    const tr = await createTransaction({
      type: 'transfer',
      amount: 500_000,
      date: '2026-11-04',
      accountId: bank.id,
      toAccountId: cash.id,
      description: 'ATM Withdrawal',
    });

    // Edit income amount 2M -> 3M
    await updateTransaction(inc.id, {
      type: 'income',
      amount: 3_000_000,
      date: '2026-11-02',
      accountId: bank.id,
      categoryId: incomeCat.id,
      description: 'Consulting Revised',
    });

    // Edit expense account Bank -> Cash and amount 300k -> 200k
    await updateTransaction(exp.id, {
      type: 'expense',
      amount: 200_000,
      date: '2026-11-03',
      accountId: cash.id,
      categoryId: expenseCat.id,
      description: 'Internet Bill Cash',
    });

    // Edit transfer destination Cash -> Wallet and amount 500k -> 750k
    await updateTransaction(tr.id, {
      type: 'transfer',
      amount: 750_000,
      date: '2026-11-04',
      accountId: bank.id,
      toAccountId: wallet.id,
      description: 'Top up Wallet C',
    });

    let snapshot = await getAccountBalancesSnapshot({ recordOrigin: 'user' });
    let map = new Map(snapshot.items.map((i) => [i.account.id, i.currentBalance]));
    // Bank: 5,000,000 + 3,000,000 - 750,000 = 7,250,000
    // Cash: 1,000,000 - 200,000 = 800,000
    // Wallet: 500,000 + 750,000 = 1,250,000
    assert.equal(map.get(bank.id), 7_250_000);
    assert.equal(map.get(cash.id), 800_000);
    assert.equal(map.get(wallet.id), 1_250_000);
    assert.equal(snapshot.totalsByCurrency.IDR.totalAccountBalance, 9_300_000);

    // Delete transfer -> restores Bank & Wallet
    await deleteTransaction(tr.id);
    snapshot = await getAccountBalancesSnapshot({ recordOrigin: 'user' });
    map = new Map(snapshot.items.map((i) => [i.account.id, i.currentBalance]));
    assert.equal(map.get(bank.id), 8_000_000);
    assert.equal(map.get(wallet.id), 500_000);
    assert.equal(await transactionsRepository.getById(tr.id), undefined);

    // Delete income & expense -> restores exact opening balances
    await deleteTransaction(inc.id);
    await deleteTransaction(exp.id);
    snapshot = await getAccountBalancesSnapshot({ recordOrigin: 'user' });
    map = new Map(snapshot.items.map((i) => [i.account.id, i.currentBalance]));
    assert.equal(map.get(bank.id), 5_000_000);
    assert.equal(map.get(cash.id), 1_000_000);
    assert.equal(map.get(wallet.id), 500_000);
  });

  it('enforces data integrity guards, investment pool exclusion, multi-currency isolation, and Asia/Jakarta dates', async () => {
    const bank = await createUserAccount({
      name: 'Protected Bank',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const unusedAccount = await createUserAccount({
      name: 'Unused Bank',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 0,
    });
    const archivedAcc = await createUserAccount({
      name: 'Old Account',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 0,
      isArchived: true,
    });

    const customUsedCat = await createCustomCategory({ name: 'Side Project', kind: 'income' });
    const customUnusedCat = await createCustomCategory({ name: 'Temp Category', kind: 'expense' });

    await createTransaction({
      type: 'income',
      amount: 500_000,
      date: '2026-11-18',
      accountId: bank.id,
      categoryId: customUsedCat.id,
      description: 'Invoice #1',
    });

    // Reject creating transaction on archived account
    await assert.rejects(
      () =>
        createTransaction({
          type: 'income',
          amount: 100_000,
          date: '2026-11-18',
          accountId: archivedAcc.id,
          categoryId: customUsedCat.id,
          description: 'Invalid archived',
        }),
      ValidationError
    );

    // Reject deleting account with transaction history or changing its currency
    await assert.rejects(() => deleteUserAccountSafely(bank.id), SafetyGuardError);
    await assert.rejects(
      () =>
        updateUserAccount(bank.id, {
          name: 'Protected Bank',
          type: 'bank',
          currency: 'USD',
          isArchived: false,
        }),
      SafetyGuardError
    );

    // Unused account CAN be deleted
    await deleteUserAccountSafely(unusedAccount.id);
    assert.equal(await accountsRepository.getById(unusedAccount.id), undefined);

    // Category with history is archived instead of deleted; unused custom category is deleted
    const usedRes = await deleteCustomCategory(customUsedCat.id);
    assert.equal(usedRes.archivedInstead, true);
    assert.equal((await categoriesRepository.getById(customUsedCat.id))?.isArchived, true);

    const unusedRes = await deleteCustomCategory(customUnusedCat.id);
    assert.equal(unusedRes.archivedInstead, false);
    assert.equal(await categoriesRepository.getById(customUnusedCat.id), undefined);

    // Pure calculation double-counting check: investment_pool + investment_cash on same platformId + USD isolation
    const mockAccounts: Account[] = [
      {
        id: 'acc-bank',
        name: 'Bank IDR',
        type: 'bank',
        currency: 'IDR',
        initialBalance: 10_000_000,
        isArchived: false,
        isTestData: false,
        recordOrigin: 'user',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'acc-pool',
        name: 'Bibit Pool',
        type: 'investment_pool',
        currency: 'IDR',
        initialBalance: 5_000_000,
        platformId: 'plat_bibit',
        isInvestmentPool: true,
        isArchived: false,
        isTestData: false,
        recordOrigin: 'user',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'acc-plat-cash',
        name: 'Bibit RDN Cash',
        type: 'investment_cash',
        currency: 'IDR',
        initialBalance: 5_000_000,
        platformId: 'plat_bibit',
        isArchived: false,
        isTestData: false,
        recordOrigin: 'user',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'acc-usd',
        name: 'Wise USD',
        type: 'bank',
        currency: 'USD',
        initialBalance: 1_000,
        isArchived: false,
        isTestData: false,
        recordOrigin: 'user',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ];

    const mockTx: Transaction[] = [
      {
        id: 'tx-dup-1',
        accountId: 'acc-bank',
        toAccountId: 'acc-pool',
        transferGroupId: 'grp-1',
        type: 'transfer',
        amount: 1_000_000,
        currency: 'IDR',
        date: '2026-11-05',
        description: 'Invest',
        status: 'posted',
        isTestData: false,
        recordOrigin: 'user',
        createdAt: '2026-11-05T00:00:00.000Z',
        updatedAt: '2026-11-05T00:00:00.000Z',
      },
      {
        // Duplicate transferGroupId should be ignored by pure engine
        id: 'tx-dup-2',
        accountId: 'acc-bank',
        toAccountId: 'acc-pool',
        transferGroupId: 'grp-1',
        type: 'transfer',
        amount: 1_000_000,
        currency: 'IDR',
        date: '2026-11-05',
        description: 'Invest duplicate',
        status: 'posted',
        isTestData: false,
        recordOrigin: 'user',
        createdAt: '2026-11-05T00:00:00.000Z',
        updatedAt: '2026-11-05T00:00:00.000Z',
      },
    ];

    const pureSnapshot = calculateAccountBalances(mockAccounts, mockTx);
    const platCashItem = pureSnapshot.items.find((i) => i.account.id === 'acc-plat-cash');
    assert.equal(platCashItem?.excludedFromConsolidatedTotal, true);
    assert.equal(pureSnapshot.totalsByCurrency.IDR.totalAccountBalance, 15_000_000);
    assert.equal(pureSnapshot.totalsByCurrency.IDR.liquidCashBalance, 9_000_000);
    assert.equal(pureSnapshot.totalsByCurrency.IDR.investmentPoolBalance, 6_000_000);
    assert.equal(pureSnapshot.totalsByCurrency.USD.totalAccountBalance, 1_000);

    const pureSummary = calculateFinancialSummary(mockTx, { primaryCurrency: 'IDR' });
    assert.equal(pureSummary.transferCount, 1);
    assert.equal(pureSummary.transactionCount, 1);

    // Asia/Jakarta timezone date check: 2026-10-31T17:30:00.000Z is 2026-11-01 00:30 WIB
    const wibToday = getTodayInTimezone('Asia/Jakarta', new Date('2026-10-31T17:30:00.000Z'));
    assert.equal(wibToday, '2026-11-01');
    const range = getPeriodDateRange('this_month', {
      timezone: 'Asia/Jakarta',
      referenceDate: new Date('2026-10-31T17:30:00.000Z'),
    });
    assert.deepEqual(range, { startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.equal(formatDisplayDate('2026-11-01', 'DD MMM YYYY'), '01 Nov 2026');
  });

  it('supports search, filtering, sorting, pagination, and persists across DB close and reopen', async () => {
    const bank = await createUserAccount({
      name: 'Main Bank',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const categories = await categoriesRepository.getUserRecords();
    const incomeCat = categories.find((c) => c.kind === 'income')!;
    const expenseCat = categories.find((c) => c.kind === 'expense')!;

    await createTransaction({
      type: 'income',
      amount: 4_000_000,
      date: '2026-11-01',
      accountId: bank.id,
      categoryId: incomeCat.id,
      description: 'Client Retainer',
      notes: 'Q4 retainer',
    });
    await createTransaction({
      type: 'expense',
      amount: 150_000,
      date: '2026-11-05',
      accountId: bank.id,
      categoryId: expenseCat.id,
      description: 'Coffee Beans',
    });
    await createTransaction({
      type: 'expense',
      amount: 250_000,
      date: '2026-11-10',
      accountId: bank.id,
      categoryId: expenseCat.id,
      description: 'Electricity Token',
      notes: 'Monthly PLN',
    });

    const searchRes = await listTransactionsFiltered({
      search: 'PLN',
      sortOrder: 'newest',
    });
    assert.equal(searchRes.totalCount, 1);
    assert.equal(searchRes.items[0]?.transaction.description, 'Electricity Token');

    const pagedNewest = await listTransactionsFiltered({
      type: 'all',
      sortOrder: 'newest',
      page: 1,
      pageSize: 2,
    });
    assert.equal(pagedNewest.totalCount, 3);
    assert.equal(pagedNewest.totalPages, 2);
    assert.equal(pagedNewest.items[0]?.transaction.date, '2026-11-10');

    const pagedOldest = await listTransactionsFiltered({
      sortOrder: 'oldest',
      page: 1,
      pageSize: 2,
    });
    assert.equal(pagedOldest.items[0]?.transaction.date, '2026-11-01');

    // Close and reopen Dexie to confirm full IndexedDB persistence
    resetDatabaseInstance();
    await ensureDatabaseOpen();

    const persistedBalances = await getAccountBalancesSnapshot({ recordOrigin: 'user' });
    const persistedBank = persistedBalances.items.find((i) => i.account.id === bank.id);
    assert.equal(persistedBank?.currentBalance, 13_600_000);

    const persistedSummary = await getFinancialSummaryForPeriod({
      preset: 'custom',
      customStart: '2026-11-01',
      customEnd: '2026-11-30',
      primaryCurrency: 'IDR',
    });
    assert.equal(persistedSummary.totalIncome, 4_000_000);
    assert.equal(persistedSummary.totalExpenses, 400_000);
    assert.equal(persistedSummary.netCashFlow, 3_600_000);
    assert.equal(persistedSummary.transactionCount, 3);
  });
});
