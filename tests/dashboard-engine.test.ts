import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import { categoriesRepository, transactionsRepository } from '@/repositories';
import { initializeApplication } from '@/services/bootstrap.service';
import { getDashboardSnapshot } from '@/services/dashboard.service';
import { isValidDateRange } from '@/lib/dates';
import {
  contributeToInvestmentPool,
  createAssetClass,
  createHolding,
  createInvestmentPlatformWithCashAccount,
  createValuationSnapshot,
  ensureInvestmentPoolAccount,
  listAssetClasses,
  recordBuyActivity,
  recordDividendActivity,
  recordValuationUpdateActivity,
  saveManualFxRate,
  transferBetweenPoolAndPlatform,
} from '@/services/investment.service';
import { createCustomCategory, createUserAccount } from '@/services/settings.service';
import { createTransaction, deleteTransaction } from '@/services/transaction.service';

async function resetLocalDatabaseForTest(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  await initializeApplication();
}

describe('Stage 5 — Dashboard & Financial Overview Engine', () => {
  it('rejects reversed custom date ranges', () => {
    assert.equal(isValidDateRange({ startDate: '2026-11-20', endDate: '2026-11-01' }), false);
    assert.equal(isValidDateRange({ startDate: '2026-11-01', endDate: '2026-11-20' }), true);
  });

  beforeEach(async () => {
    resetDatabaseInstance();
    await resetLocalDatabaseForTest();
  });

  it('1. Net Worth & Available Cash: cash-only, investment-only, combined without double counting, and FX gating', async () => {
    // 1A. Cash-only portfolio
    const bca = await createUserAccount({
      name: 'BCA Main',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 12_000_000,
    });
    const gopay = await createUserAccount({
      name: 'GoPay',
      type: 'ewallet',
      currency: 'IDR',
      initialBalance: 1_500_000,
    });
    const cash = await createUserAccount({
      name: 'Wallet Cash',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 500_000,
    });

    const cashOnlyDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(cashOnlyDash.metrics.availableCash, 14_000_000);
    assert.equal(cashOnlyDash.metrics.investmentValue, 0);
    assert.equal(cashOnlyDash.metrics.netWorth, 14_000_000);
    assert.equal(cashOnlyDash.metrics.liabilitiesSupported, false);
    assert.equal(cashOnlyDash.availableCashAccounts.length, 3);

    // 1B. Add Investment Pool + Platform Cash + Holdings (must never double count)
    const pool = await ensureInvestmentPoolAccount('IDR');
    const stockbit = await createInvestmentPlatformWithCashAccount({
      name: 'Stockbit',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      supportsInvestmentPool: true,
    });

    // Contribute 5,000,000 from BCA -> Pool (Available Cash becomes 9,000,000; Pool becomes 5,000,000)
    await contributeToInvestmentPool({
      sourceAccountId: bca.id,
      destinationAccountId: pool.id,
      amount: 5_000_000,
      date: '2026-11-05',
    });

    // Move 3,500,000 from Pool -> Stockbit Cash (Pool = 1,500,000; Platform Cash = 3,500,000)
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: stockbit.id,
      direction: 'pool_to_platform',
      amount: 3_500_000,
      date: '2026-11-06',
    });

    const classes = await listAssetClasses();
    const indoStock = classes.find((c) => c.code === 'INDO_STOCK')!;
    const bbca = await createHolding({
      symbol: 'BBCA',
      name: 'Bank Central Asia',
      platformId: stockbit.id,
      assetClassId: indoStock.id,
      currency: 'IDR',
    });

    // Buy 200 units @ 10,000 = 2,000,000 (Platform Cash becomes 1,500,000; Holdings MV = 2,000,000)
    await recordBuyActivity({
      platformId: stockbit.id,
      holdingId: bbca.id,
      quantity: 200,
      unitPrice: 10_000,
      feeAmount: 0,
      activityDate: '2026-11-08',
    });

    // Revalue BBCA to 11,000 -> Holdings MV = 2,200,000; Total Investment = 1.5M + 1.5M + 2.2M = 5,200,000
    await recordValuationUpdateActivity({
      holdingId: bbca.id,
      unitPrice: 11_000,
      valuationDate: '2026-11-18',
      recordSnapshot: false, // Intentionally omit historical valuation snapshots first
    });

    const combinedDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(combinedDash.metrics.availableCash, 9_000_000);
    assert.equal(combinedDash.metrics.investmentValue, 5_200_000);
    assert.equal(combinedDash.metrics.netWorth, 14_200_000);
    assert.equal(combinedDash.availableCashAccounts.map((a) => a.account.id).includes(pool.id), false);
    assert.equal(
      combinedDash.availableCashAccounts.map((a) => a.account.id).includes(stockbit.cashAccountId!),
      false
    );
    assert.ok(cash.id && gopay.id);

    // 1C. Missing historical valuation data: open holding without past valuation snapshots
    // Pre-purchase dates (Nov 5, Nov 6) have qty=0 so cash is known; Nov 8 (holding open, no snapshot) MUST be omitted (never fabricated!)
    assert.equal(
      combinedDash.netWorthTrend.points.some((p) => p.date === '2026-11-08'),
      false,
      'Must not fabricate historical holding value for 2026-11-08 without a recorded snapshot'
    );

    // Once we record a historical holding snapshot on 2026-11-10, that date becomes a verified snapshot point
    await createValuationSnapshot({
      scope: 'holding',
      holdingId: bbca.id,
      valuationDate: '2026-11-10',
      currency: 'IDR',
      unitPrice: 10_500,
      marketValue: 2_100_000,
      costBasis: 2_000_000,
    });

    const dashWithTrend = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(dashWithTrend.netWorthTrend.hasSufficientData, true);
    const nov10Point = dashWithTrend.netWorthTrend.points.find((p) => p.date === '2026-11-10');
    assert.ok(nov10Point, '2026-11-10 snapshot point should now be present');
    assert.equal(nov10Point.dataSource, 'snapshot');
    // On Nov 10: Pool (1.5M) + Platform Cash (1.5M) + BBCA (200 * 10,500 = 2.1M) = 5,100,000
    assert.equal(nov10Point.investmentValue, 5_100_000);
    assert.ok(dashWithTrend.netWorthTrend.snapshotPointCount >= 1);

    // 1D. Multi-currency safety: USD account & USD platform excluded until explicit manual FX rate is saved
    await createUserAccount({
      name: 'Wise USD',
      type: 'bank',
      currency: 'USD',
      initialBalance: 1_000,
    });
    const usBroker = await createInvestmentPlatformWithCashAccount({
      name: 'IBKR',
      kind: 'brokerage',
      defaultCurrency: 'USD',
      initialCashBalance: 500,
    });
    assert.ok(usBroker.id);

    const beforeFxDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(beforeFxDash.metrics.netWorth, 14_200_000);
    assert.deepEqual(beforeFxDash.metrics.excludedCurrencies, ['USD']);
    assert.equal(beforeFxDash.metrics.excludedCurrencyItems[0]?.totalValue, 1_500);

    // Save explicit manual FX rate 1 USD = 16,000 IDR -> +16M Available Cash, +8M Investment = +24M Net Worth
    await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 16_000,
      date: '2026-11-20',
    });

    const afterFxDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.deepEqual(afterFxDash.metrics.excludedCurrencies, []);
    assert.equal(afterFxDash.metrics.availableCash, 25_000_000);
    assert.equal(afterFxDash.metrics.investmentValue, 13_200_000);
    assert.equal(afterFxDash.metrics.netWorth, 38_200_000);
  });

  it('2. Investment-only portfolio keeps Available Cash at 0, matches Investment Value, and gates insufficient historical snapshots', async () => {
    const exchange = await createInvestmentPlatformWithCashAccount({
      name: 'Crypto Desk',
      kind: 'crypto_exchange',
      defaultCurrency: 'IDR',
      initialCashBalance: 2_500_000,
    });
    const cryptoClass = (await listAssetClasses()).find((c) => c.code === 'CRYPTO')!;
    const eth = await createHolding({
      symbol: 'ETH',
      name: 'Ethereum',
      platformId: exchange.id,
      assetClassId: cryptoClass.id,
      currency: 'IDR',
    });
    await recordBuyActivity({
      platformId: exchange.id,
      holdingId: eth.id,
      quantity: 0.5,
      unitPrice: 4_000_000,
      feeAmount: 0,
      activityDate: '2026-11-05',
    });
    await recordValuationUpdateActivity({
      holdingId: eth.id,
      unitPrice: 4_000_000,
      valuationDate: '2026-11-20',
    });

    const dash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(dash.metrics.availableCash, 0);
    assert.equal(dash.metrics.investmentValue, 2_500_000);
    assert.equal(dash.metrics.netWorth, 2_500_000);
    // Only today (2026-11-20) has a valid valuation; 2026-11-05 is skipped without a snapshot -> insufficient for trend
    assert.equal(dash.netWorthTrend.hasSufficientData, false);
    assert.equal(dash.netWorthTrend.points.length, 1);
  });

  it('3. Cash Flow, Period Filtering, Transfer Exclusion, and Safe Previous-Period Comparison', async () => {
    const bank = await createUserAccount({
      name: 'Mandiri',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const wallet = await createUserAccount({
      name: 'OVO',
      type: 'ewallet',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');

    const cats = await categoriesRepository.getUserRecords();
    const salaryCat = cats.find((c) => c.kind === 'income')!;
    const foodCat = cats.find((c) => c.kind === 'expense')!;

    // Current period (Nov 2026): Income 12M (on boundary start 2026-11-01), Expense 3M (on boundary end 2026-11-30)
    await createTransaction({
      type: 'income',
      amount: 12_000_000,
      date: '2026-11-01',
      accountId: bank.id,
      categoryId: salaryCat.id,
      description: 'Nov Salary',
    });
    await createTransaction({
      type: 'expense',
      amount: 3_000_000,
      date: '2026-11-30',
      accountId: bank.id,
      categoryId: foodCat.id,
      description: 'Nov Living',
    });
    // Internal transfer & investment pool contribution in Nov -> must be excluded from Income/Expenses
    await createTransaction({
      type: 'transfer',
      amount: 2_000_000,
      date: '2026-11-10',
      accountId: bank.id,
      toAccountId: wallet.id,
      description: 'Top up OVO',
    });
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 4_000_000,
      date: '2026-11-12',
    });

    // Test when previous period has ZERO records -> percentageChange must safely be null
    const novNoPrior = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(novNoPrior.metrics.periodIncome, 12_000_000);
    assert.equal(novNoPrior.metrics.periodExpenses, 3_000_000);
    assert.equal(novNoPrior.metrics.periodNetCashFlow, 9_000_000);
    assert.equal(novNoPrior.metrics.savingsRatePct, 75);
    assert.equal(novNoPrior.metrics.comparison.previousIncome, 0);
    assert.equal(novNoPrior.metrics.comparison.incomeChangePct, null);
    assert.equal(novNoPrior.metrics.comparison.expenseChangePct, null);
    assert.equal(novNoPrior.incomeVsExpenses.points.length, 2); // 2026-11-01 and 2026-11-30 only (transfers excluded)

    // Add Oct 2026 prior-month records + earlier 2025 record
    await createTransaction({
      type: 'income',
      amount: 10_000_000,
      date: '2026-10-15',
      accountId: bank.id,
      categoryId: salaryCat.id,
      description: 'Oct Salary',
    });
    await createTransaction({
      type: 'expense',
      amount: 4_000_000,
      date: '2026-10-20',
      accountId: bank.id,
      categoryId: foodCat.id,
      description: 'Oct Living',
    });
    await createTransaction({
      type: 'income',
      amount: 8_000_000,
      date: '2025-06-10',
      accountId: bank.id,
      categoryId: salaryCat.id,
      description: 'Mid-2025 Bonus',
    });

    const novWithPrior = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(novWithPrior.metrics.comparison.previousIncome, 10_000_000);
    assert.equal(novWithPrior.metrics.comparison.incomeChangeAbs, 2_000_000);
    assert.equal(novWithPrior.metrics.comparison.incomeChangePct, 20);
    assert.equal(novWithPrior.metrics.comparison.previousExpenses, 4_000_000);
    assert.equal(novWithPrior.metrics.comparison.expenseChangeAbs, -1_000_000);
    assert.equal(novWithPrior.metrics.comparison.expenseChangePct, -25);

    // Test current-year, custom, and full-year date ranges.
    const sixMonthsDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_year',
    });
    assert.equal(sixMonthsDash.metrics.periodIncome, 22_000_000);
    assert.equal(sixMonthsDash.metrics.periodExpenses, 7_000_000);

    const lastYearDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'custom',
      customStart: '2025-01-01',
      customEnd: '2025-12-31',
    });
    assert.equal(lastYearDash.metrics.periodIncome, 8_000_000);
    assert.equal(lastYearDash.metrics.periodExpenses, 0);

    const customDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'custom',
      customStart: '2026-10-15',
      customEnd: '2026-11-01',
    });
    assert.equal(customDash.metrics.periodIncome, 22_000_000);
    assert.equal(customDash.metrics.periodExpenses, 4_000_000);

    const allTimeDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'custom',
      customStart: '2000-01-01',
      customEnd: '2026-11-20',
    });
    assert.equal(allTimeDash.metrics.periodIncome, 30_000_000);
    assert.equal(allTimeDash.metrics.periodExpenses, 4_000_000);
  });

  it('4. Asset Allocation & Expense Breakdown accurately sum 100%, handle custom categories & FX, and handle zero expenses', async () => {
    const bank = await createUserAccount({
      name: 'Bank Cash',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const ewallet = await createUserAccount({
      name: 'DANA',
      type: 'ewallet',
      currency: 'IDR',
      initialBalance: 2_000_000,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 4_000_000,
      date: '2026-11-01',
    });
    // Bank = 6M, E-Wallet = 2M, Pool = 4M -> Move 2M to platform -> Pool = 2M, Platform Cash = 2M
    const broker = await createInvestmentPlatformWithCashAccount({
      name: 'Mirae',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
    });
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: broker.id,
      amount: 2_000_000,
      date: '2026-11-02',
    });
    const customAssetClass = await createAssetClass({ name: 'REITs', code: 'REIT' });
    const reitHolding = await createHolding({
      symbol: 'DIRE',
      name: 'Dana Investasi Real Estat',
      platformId: broker.id,
      assetClassId: customAssetClass.id,
      currency: 'IDR',
    });
    // Buy 1,000,000 -> Platform Cash = 1M, Holdings = 1M
    await recordBuyActivity({
      platformId: broker.id,
      holdingId: reitHolding.id,
      quantity: 1000,
      unitPrice: 1000,
      feeAmount: 0,
      activityDate: '2026-11-03',
    });
    await recordValuationUpdateActivity({
      holdingId: reitHolding.id,
      unitPrice: 1_000,
      valuationDate: '2026-11-20',
    });

    const zeroExpDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    // Zero-expense handling
    assert.equal(zeroExpDash.expenseBreakdown.totalExpenses, 0);
    assert.equal(zeroExpDash.expenseBreakdown.items.length, 0);

    // Total Financial Assets breakdown = Bank 6M (50%) + EWallet 2M (16.67%) + Pool 2M (16.67%) + PlatCash 1M (8.33%) + Holdings 1M (8.33%) = 12M
    assert.equal(zeroExpDash.assetAllocation.totalAssetsConverted, 12_000_000);
    const totalPct = zeroExpDash.assetAllocation.totalAssetsItems.reduce(
      (sum, item) => sum + item.percentage,
      0
    );
    assert.ok(Math.abs(totalPct - 100) < 0.1, `Expected ~100%, got ${totalPct}`);
    assert.equal(zeroExpDash.assetAllocation.investmentOnlyItems[0]?.name, 'REITs');
    assert.equal(zeroExpDash.assetAllocation.investmentOnlyItems[0]?.percentage, 100);

    // Expense breakdown across default + custom category + prior period comparison
    const cats = await categoriesRepository.getUserRecords();
    const foodCat = cats.find((c) => c.kind === 'expense')!;
    const coffeeCat = await createCustomCategory({ name: 'Specialty Coffee', kind: 'expense' });

    await createTransaction({
      type: 'expense',
      amount: 1_500_000,
      date: '2026-11-05',
      accountId: bank.id,
      categoryId: foodCat.id,
      description: 'Groceries',
    });
    await createTransaction({
      type: 'expense',
      amount: 500_000,
      date: '2026-11-06',
      accountId: ewallet.id,
      categoryId: coffeeCat.id,
      description: 'Beans & Pour Over',
    });
    await createTransaction({
      type: 'expense',
      amount: 1_000_000,
      date: '2026-10-10',
      accountId: bank.id,
      categoryId: foodCat.id,
      description: 'Oct Groceries',
    });

    const expDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(expDash.expenseBreakdown.totalExpenses, 2_000_000);
    assert.equal(expDash.expenseBreakdown.items.length, 2);
    assert.equal(expDash.expenseBreakdown.items[0]?.categoryName, foodCat.name);
    assert.equal(expDash.expenseBreakdown.items[0]?.percentageOfTotal, 75);
    assert.equal(expDash.expenseBreakdown.items[0]?.percentageChange, 50); // 1.5M vs 1.0M
    assert.equal(expDash.expenseBreakdown.items[1]?.categoryName, 'Specialty Coffee');
    assert.equal(expDash.expenseBreakdown.items[1]?.percentageOfTotal, 25);
    assert.equal(expDash.expenseBreakdown.items[1]?.percentageChange, null); // prior = 0
  });

  it('5. Recent Transactions deduplicates paired transfers, respects test isolation, and updates on delete', async () => {
    const bank = await createUserAccount({
      name: 'Bank A',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 8_000_000,
    });
    const cash = await createUserAccount({
      name: 'Cash Wallet',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const cats = await categoriesRepository.getUserRecords();
    const expCat = cats.find((c) => c.kind === 'expense')!;
    const incCat = cats.find((c) => c.kind === 'income')!;

    await createTransaction({
      type: 'income',
      amount: 5_000_000,
      date: '2026-11-02',
      accountId: bank.id,
      categoryId: incCat.id,
      description: 'First Income',
    });
    await createTransaction({
      type: 'transfer',
      amount: 1_000_000,
      date: '2026-11-08',
      accountId: bank.id,
      toAccountId: cash.id,
      description: 'ATM Withdrawal',
    });
    const newestExp = await createTransaction({
      type: 'expense',
      amount: 250_000,
      date: '2026-11-15',
      accountId: cash.id,
      categoryId: expCat.id,
      description: 'Dinner Out',
    });

    // Insert an isolated test-origin transaction directly; must NOT leak into user dashboard
    await transactionsRepository.create({
      id: 'tx_isolated_test_only',
      accountId: bank.id,
      type: 'expense',
      amount: 99_999_999,
      currency: 'IDR',
      date: '2026-11-19',
      categoryId: expCat.id,
      description: 'Stage 1 Sandbox Test Expense',
      status: 'posted',
      isTestData: true,
      recordOrigin: 'test',
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: '2026-11-19T00:00:00.000Z',
    });

    const dash1 = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(dash1.recentTransactions.length, 3);
    assert.equal(dash1.recentTransactions[0]?.transaction.description, 'Dinner Out');
    assert.equal(dash1.recentTransactions[1]?.transaction.description, 'ATM Withdrawal');
    assert.equal(dash1.recentTransactions[2]?.transaction.description, 'First Income');
    assert.equal(dash1.metrics.periodExpenses, 250_000);

    // Delete newest expense -> immediately excluded from recent transactions & balances
    await deleteTransaction(newestExp.id);
    const dash2 = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(dash2.recentTransactions.length, 2);
    assert.equal(dash2.recentTransactions[0]?.transaction.description, 'ATM Withdrawal');
    assert.equal(dash2.metrics.periodExpenses, 0);
  });

  it('6. Deterministic Financial Insights & Persistence across DB reopen', async () => {
    // Empty state produces zero speculative insights
    const emptyDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(emptyDash.insights.length, 0);

    // Build realistic cash + investment records
    const bank = await createUserAccount({
      name: 'BCA Daily',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const petty = await createUserAccount({
      name: 'Petty Cash',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 50_000, // Low balance (< 100,000 IDR threshold)
    });
    const cats = await categoriesRepository.getUserRecords();
    const incCat = cats.find((c) => c.kind === 'income')!;
    const expCat = cats.find((c) => c.kind === 'expense')!;

    await createTransaction({
      type: 'income',
      amount: 10_000_000,
      date: '2026-11-01',
      accountId: bank.id,
      categoryId: incCat.id,
      description: 'Salary',
    });
    await createTransaction({
      type: 'expense',
      amount: 2_000_000,
      date: '2026-11-04',
      accountId: bank.id,
      categoryId: expCat.id,
      description: 'Monthly Rent',
    });
    await createTransaction({
      type: 'expense',
      amount: 500_000,
      date: '2026-10-15',
      accountId: bank.id,
      categoryId: expCat.id,
      description: 'Last Month Bills',
    });

    const broker = await createInvestmentPlatformWithCashAccount({
      name: 'Stockbit',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      initialCashBalance: 0,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 4_000_000,
      date: '2026-11-05',
    });
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: broker.id,
      amount: 4_000_000,
      date: '2026-11-05',
    });
    const indoClass = (await listAssetClasses()).find((c) => c.code === 'INDO_STOCK')!;
    const bmri = await createHolding({
      symbol: 'BMRI',
      name: 'Bank Mandiri',
      platformId: broker.id,
      assetClassId: indoClass.id,
      currency: 'IDR',
    });
    await recordBuyActivity({
      platformId: broker.id,
      holdingId: bmri.id,
      quantity: 500,
      unitPrice: 6_000,
      feeAmount: 0,
      activityDate: '2026-11-06',
    });
    await recordDividendActivity({
      platformId: broker.id,
      holdingId: bmri.id,
      amount: 250_000,
      activityDate: '2026-11-12',
    });
    await recordValuationUpdateActivity({
      holdingId: bmri.id,
      unitPrice: 6_400,
      valuationDate: '2026-11-12',
      recordSnapshot: true,
    });

    const liveDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });

    const insightIds = new Set(liveDash.insights.map((i) => i.id));
    assert.ok(insightIds.has('highest_expense_category'));
    assert.ok(insightIds.has('largest_expense_tx'));
    assert.ok(insightIds.has('savings_rate'));
    assert.ok(insightIds.has('expense_trend'));
    assert.ok(insightIds.has('investment_concentration'));
    assert.ok(insightIds.has('low_balance_accounts'));
    assert.ok(petty.id);

    // Simulate full browser reload / DB close & reopen
    resetDatabaseInstance();
    await ensureDatabaseOpen();

    const reloadedDash = await getDashboardSnapshot({
      todayOverride: '2026-11-20',
      periodPreset: 'this_month',
    });
    assert.equal(reloadedDash.metrics.netWorth, liveDash.metrics.netWorth);
    assert.equal(reloadedDash.metrics.availableCash, liveDash.metrics.availableCash);
    assert.equal(reloadedDash.metrics.investmentValue, liveDash.metrics.investmentValue);
    assert.equal(reloadedDash.metrics.periodIncome, liveDash.metrics.periodIncome);
    assert.equal(reloadedDash.metrics.periodExpenses, liveDash.metrics.periodExpenses);
    assert.equal(reloadedDash.recentTransactions.length, liveDash.recentTransactions.length);
  });
});
