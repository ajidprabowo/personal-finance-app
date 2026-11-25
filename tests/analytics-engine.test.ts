import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { categoriesRepository } from '@/repositories';
import { getAnalyticsSnapshot } from '@/services/analytics.service';
import { initializeApplication } from '@/services/bootstrap.service';
import { createCategoryBudget } from '@/services/budget.service';
import { verifyDexieMigrationProbe } from '@/services/health.service';
import {
  contributeToInvestmentPool,
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
import { createUserAccount } from '@/services/settings.service';
import { createTransaction } from '@/services/transaction.service';

async function resetLocalDatabaseForTest(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  await initializeApplication();
}

describe('Stage 6 — Financial Analytics Engine & v6 Migration', () => {
  beforeEach(async () => {
    resetDatabaseInstance();
    await resetLocalDatabaseForTest();
  });

  it('1. Cashflow, Savings, Expense-to-Income Ratio, Behavior, and Exclusion of Transfers/Investments', async () => {
    const bca = await createUserAccount({
      name: 'BCA Main',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const cash = await createUserAccount({
      name: 'Wallet',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 1_000_000,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');

    const cats = await categoriesRepository.getUserRecords();
    const salary = cats.find((c) => c.kind === 'income')!;
    const food = cats.find((c) => c.kind === 'expense' && c.name.toLowerCase().includes('food'))!;
    const utilities = cats.find((c) => c.kind === 'expense' && c.id !== food.id)!;

    // Prior period (2026-09): Income 8,000,000; Expenses 4,000,000
    await createTransaction({
      accountId: bca.id,
      type: 'income',
      categoryId: salary.id,
      amount: 8_000_000,
      currency: 'IDR',
      date: '2026-09-05',
      description: 'Sept Salary',
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 4_000_000,
      currency: 'IDR',
      date: '2026-09-12',
      description: 'Sept Food',
    });

    // Current month (2026-10): Income 10,000,000; Expenses 3,000,000 (2,000k food + 1,000k utilities)
    await createTransaction({
      accountId: bca.id,
      type: 'income',
      categoryId: salary.id,
      amount: 10_000_000,
      currency: 'IDR',
      date: '2026-10-05',
      description: 'Oct Salary',
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 1_200_000,
      currency: 'IDR',
      date: '2026-10-10', // Saturday (weekend)
      description: 'Weekend groceries',
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 800_000,
      currency: 'IDR',
      date: '2026-10-12', // Monday (weekday)
      description: 'Weekday lunch',
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: utilities.id,
      amount: 1_000_000,
      currency: 'IDR',
      date: '2026-10-14',
      description: 'Internet Bill',
    });

    // Transfer & Investment Contribution MUST NEVER inflate Income or Expenses
    await createTransaction({
      accountId: bca.id,
      toAccountId: cash.id,
      type: 'transfer',
      amount: 2_000_000,
      currency: 'IDR',
      date: '2026-10-15',
      description: 'Internal transfer',
    });
    await contributeToInvestmentPool({
      sourceAccountId: bca.id,
      destinationAccountId: pool.id,
      amount: 3_000_000,
      date: '2026-10-16',
    });

    const octSnap = await getAnalyticsSnapshot({
      periodPreset: 'this_month',
      todayOverride: '2026-10-20',
    });

    assert.equal(octSnap.income.totalIncome, 10_000_000);
    assert.equal(octSnap.income.previousIncome, 8_000_000);
    assert.equal(octSnap.income.incomeChangePct, 25);

    assert.equal(octSnap.expenses.totalExpenses, 3_000_000);
    assert.equal(octSnap.expenses.previousExpenses, 4_000_000);
    assert.equal(octSnap.expenses.expenseChangePct, -25);

    assert.equal(octSnap.savings.totalSavings, 7_000_000);
    assert.equal(octSnap.savings.savingsRatePct, 70);
    assert.equal(octSnap.savings.expenseToIncomeRatioPct, 30);

    // Behavior metrics
    assert.equal(octSnap.spendingBehavior.highestSpendingCategory?.categoryId, food.id);
    assert.equal(octSnap.spendingBehavior.mostFrequentCategory?.transactionCount, 2);
    assert.equal(octSnap.spendingBehavior.highestSpendingDay?.date, '2026-10-10');
    assert.equal(octSnap.spendingBehavior.weekdayVsWeekend.weekendTotal, 1_200_000);
    assert.equal(octSnap.spendingBehavior.weekdayVsWeekend.weekdayTotal, 1_800_000);

    // Health indicators expose explicit formulas
    const savingsInd = octSnap.healthIndicators.find((i) => i.id === 'savings_rate')!;
    assert.equal(savingsInd.value, 70);
    assert.ok(savingsInd.formula.includes('Total Income'));

    // Category filter narrows analytics cleanly
    const foodOnly = await getAnalyticsSnapshot({
      periodPreset: 'this_month',
      categoryId: food.id,
      todayOverride: '2026-10-20',
    });
    assert.equal(foodOnly.expenses.totalExpenses, 2_000_000);
  });

  it('2. Zero Income, Negative Savings, Empty Historical Data, and Insufficient Insight Guards', async () => {
    const bca = await createUserAccount({
      name: 'BCA',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 5_000_000,
    });
    const cats = await categoriesRepository.getUserRecords();
    const expenseCat = cats.find((c) => c.kind === 'expense')!;

    // Empty state first
    const emptySnap = await getAnalyticsSnapshot({
      periodPreset: 'this_year',
      todayOverride: '2026-11-20',
    });
    assert.equal(emptySnap.overview.totalIncome, 0);
    assert.equal(emptySnap.overview.totalExpenses, 0);
    assert.equal(emptySnap.savings.savingsRatePct, null);
    assert.equal(emptySnap.netWorth.trend.hasSufficientData, false);
    assert.equal(emptySnap.insights.length, 0);

    // Single expense with zero income -> negative savings, unavailable savings rate (never NaN/Infinity)
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: expenseCat.id,
      amount: 300_000,
      currency: 'IDR',
      date: '2026-11-10',
      description: 'Groceries',
    });

    const zeroIncomeSnap = await getAnalyticsSnapshot({
      periodPreset: 'this_month',
      todayOverride: '2026-11-20',
    });
    assert.equal(zeroIncomeSnap.savings.hasZeroIncome, true);
    assert.equal(zeroIncomeSnap.savings.hasNegativeSavings, true);
    assert.equal(zeroIncomeSnap.savings.totalSavings, -300_000);
    assert.equal(zeroIncomeSnap.savings.savingsRatePct, null);
    assert.equal(zeroIncomeSnap.savings.expenseToIncomeRatioPct, null);
    assert.equal(
      zeroIncomeSnap.healthIndicators.find((i) => i.id === 'savings_rate')?.status,
      'insufficient'
    );
  });

  it('3. Investment Analytics, Consolidated Net Worth, Budget Overrun Insights, and Multi-Currency FX Safety', async () => {
    const bca = await createUserAccount({
      name: 'BCA',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 20_000_000,
    });
    const usdAcc = await createUserAccount({
      name: 'USD Brokerage Bank',
      type: 'bank',
      currency: 'USD',
      initialBalance: 1_000,
    });

    const pool = await ensureInvestmentPoolAccount('IDR');
    const stockbit = await createInvestmentPlatformWithCashAccount({
      name: 'Stockbit',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      supportsInvestmentPool: true,
    });

    await contributeToInvestmentPool({
      sourceAccountId: bca.id,
      destinationAccountId: pool.id,
      amount: 10_000_000,
      date: '2026-10-01',
    });
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: stockbit.id,
      direction: 'pool_to_platform',
      amount: 8_000_000,
      date: '2026-10-02',
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

    await recordBuyActivity({
      platformId: stockbit.id,
      holdingId: bbca.id,
      quantity: 500,
      unitPrice: 10_000,
      feeAmount: 0,
      activityDate: '2026-10-03',
    });
    await recordValuationUpdateActivity({
      holdingId: bbca.id,
      unitPrice: 12_000, // Market value 6,000,000 -> +1,000,000 unrealized gain
      valuationDate: '2026-10-20',
    });
    await recordDividendActivity({
      platformId: stockbit.id,
      holdingId: bbca.id,
      amount: 200_000,
      feeAmount: 0,
      activityDate: '2026-10-22',
    });

    await createValuationSnapshot({
      scope: 'portfolio',
      valuationDate: '2026-10-05',
      marketValue: 10_000_000,
      costBasis: 5_000_000,
      currency: 'IDR',
    });
    await createValuationSnapshot({
      scope: 'portfolio',
      valuationDate: '2026-10-25',
      marketValue: 11_200_000,
      costBasis: 5_000_000,
      currency: 'IDR',
    });

    // Add budget overrun in 2026-10 so Analytics Insights & Health Indicator reflect Budget module
    const cats = await categoriesRepository.getUserRecords();
    const food = cats.find((c) => c.kind === 'expense')!;
    await createCategoryBudget({
      categoryId: food.id,
      year: 2026,
      month: 10,
      limitAmount: 500_000,
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 750_000,
      currency: 'IDR',
      date: '2026-10-18',
      description: 'Family dinner',
    });

    // Without USD->IDR FX rate, USD is safely flagged as excluded
    let snap = await getAnalyticsSnapshot({
      periodPreset: 'this_month',
      todayOverride: '2026-10-28',
    });
    assert.ok(snap.excludedCurrencies.includes('USD'));

    // With manual FX rate 1 USD = 16,000 IDR, consolidated Net Worth includes USD 1,000 (16,000,000 IDR)
    await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 16_000,
      date: '2026-10-28',
    });

    snap = await getAnalyticsSnapshot({
      periodPreset: 'this_month',
      todayOverride: '2026-10-28',
    });
    assert.deepEqual(snap.excludedCurrencies, []);
    // Cash: 20M - 10M - 750k + 16M = 25,250,000
    // Investments: Pool 2M + Stockbit Cash (8M - 5M + 200k div = 3.2M) + BBCA MV (6M) = 11,200,000
    assert.equal(snap.netWorth.availableCash, 25_250_000);
    assert.equal(snap.investments.totalInvestmentValue, 11_200_000);
    assert.equal(snap.netWorth.currentNetWorth, 36_450_000);
    assert.equal(snap.investments.unrealizedPnl, 1_000_000);
    assert.equal(snap.investments.dividendAndInterestTotal, 200_000);

    // Budget utilization health indicator & overrun insight populated cleanly
    const budgetInd = snap.healthIndicators.find((i) => i.id === 'budget_utilization')!;
    assert.equal(budgetInd.value, 150);
    assert.ok(snap.insights.some((ins) => ins.id === 'analytics_budget_overrun'));

    // Filter by asset class restricts Investment Analytics cleanly without losing Net Worth integrity
    const classFiltered = await getAnalyticsSnapshot({
      periodPreset: 'this_month',
      assetClassId: indoStock.id,
      todayOverride: '2026-10-28',
    });
    assert.equal(classFiltered.investments.isFilteredSubset, true);
    assert.equal(classFiltered.investments.totalInvestmentValue, 6_000_000);

    // Verify Dexie v1 -> v7 schema migration probe passes cleanly
    const probe = await verifyDexieMigrationProbe();
    assert.equal(probe.passed, true);
    assert.equal(probe.testedToVersion, APP_CONFIG.currentSchemaVersion);
  });
});
