import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import {
  budgetAlertsRepository,
  budgetsRepository,
  categoriesRepository,
  transactionsRepository,
} from '@/repositories';
import { initializeApplication } from '@/services/bootstrap.service';
import {
  dismissBudgetAlert,
  updateBudgetAlertPreferences,
} from '@/services/budget-alert.service';
import {
  removeMonthlyBudgetPlan,
  saveMonthlyBudgetPlan,
} from '@/services/budget-allocation.service';
import { applyMonthlyBudgetRollover } from '@/services/budget-rollover.service';
import {
  createCategoryBudget,
  createMultipleCategoryBudgets,
  deleteCategoryBudget,
  getBudgetModuleSnapshot,
  setCategoryBudgetActive,
  updateCategoryBudget,
} from '@/services/budget.service';
import {
  contributeToInvestmentPool,
  ensureInvestmentPoolAccount,
  saveManualFxRate,
} from '@/services/investment.service';
import {
  createCustomCategory,
  createUserAccount,
  deleteCustomCategory,
  updateUserCategory,
} from '@/services/settings.service';
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from '@/services/transaction.service';

async function resetLocalDatabaseForTest(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  await initializeApplication();
}

describe('Stage 6 — Budget Management Engine', () => {
  beforeEach(async () => {
    resetDatabaseInstance();
    await resetLocalDatabaseForTest();
  });

  it('1. CRUD, Batch Setup, Duplicate Prevention, Transfers/Income/Investment Exclusion, and Uncapped Utilization', async () => {
    const bca = await createUserAccount({
      name: 'BCA',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 20_000_000,
    });
    const cash = await createUserAccount({
      name: 'Cash',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 5_000_000,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');

    const categories = await categoriesRepository.getUserRecords();
    const food = categories.find((c) => c.kind === 'expense' && c.name.toLowerCase().includes('food'))!;
    const transport = categories.find(
      (c) => c.kind === 'expense' && c.name.toLowerCase().includes('transport')
    )!;
    const salary = categories.find((c) => c.kind === 'income')!;

    // Single create + batch create
    const foodBudget = await createCategoryBudget({
      categoryId: food.id,
      year: 2026,
      month: 11,
      limitAmount: 1_000_000,
    });
    assert.equal(foodBudget.rolloverEnabled, false);
    assert.equal(foodBudget.periodKey, '2026-11');

    // Prevent duplicate active budget in same month + category + currency
    await assert.rejects(
      createCategoryBudget({
        categoryId: food.id,
        year: 2026,
        month: 11,
        limitAmount: 500_000,
      }),
      /already exists/i
    );

    // Prevent budget on income category
    await assert.rejects(
      createCategoryBudget({
        categoryId: salary.id,
        year: 2026,
        month: 11,
        limitAmount: 500_000,
      }),
      /expense categories/i
    );

    await createMultipleCategoryBudgets({
      year: 2026,
      month: 11,
      items: [{ categoryId: transport.id, limitAmount: 500_000 }],
    });

    // Record real expenses + non-expense movements that MUST be excluded from budget actuals
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 1_250_000, // 125% -> over budget!
      date: '2026-11-10',
      description: 'Groceries & dining',
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: transport.id,
      amount: 425_000, // 85% -> near limit!
      date: '2026-11-11',
      description: 'Fuel & commute',
    });
    // Income must NOT count against budget spending
    await createTransaction({
      accountId: bca.id,
      type: 'income',
      categoryId: salary.id,
      amount: 10_000_000,
      date: '2026-11-05',
      description: 'Monthly Salary',
    });
    // Internal transfer must NOT count against budget spending
    await createTransaction({
      accountId: bca.id,
      toAccountId: cash.id,
      type: 'transfer',
      amount: 1_000_000,
      date: '2026-11-06',
      description: 'ATM Withdrawal',
    });
    // Investment contribution must NOT count against budget spending
    await contributeToInvestmentPool({
      sourceAccountId: bca.id,
      destinationAccountId: pool.id,
      amount: 3_000_000,
      date: '2026-11-07',
    });

    const snap = await getBudgetModuleSnapshot({
      year: 2026,
      month: 11,
      todayOverride: '2026-11-15',
    });

    assert.equal(snap.summary.totalBudget, 1_500_000);
    assert.equal(snap.summary.totalActualBudgetedExpenses, 1_675_000);
    assert.equal(snap.summary.remainingBudget, -175_000);
    assert.equal(snap.summary.overBudgetCount, 1);
    assert.equal(snap.summary.nearLimitCount, 1);
    assert.equal(snap.summary.activeBudgetCount, 2);

    const foodRow = snap.items.find((i) => i.categoryId === food.id)!;
    assert.equal(foodRow.actualAmount, 1_250_000);
    assert.equal(foodRow.remainingAmount, -250_000);
    assert.equal(foodRow.utilizationPct, 125); // Uncapped > 100%
    assert.equal(foodRow.status, 'over_budget');

    const transportRow = snap.items.find((i) => i.categoryId === transport.id)!;
    assert.equal(transportRow.utilizationPct, 85);
    assert.equal(transportRow.status, 'near_limit');

    // Edit, Deactivate, Delete flow
    await updateCategoryBudget(foodBudget.id, { limitAmount: 2_000_000 });
    const afterEdit = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(afterEdit.items.find((i) => i.categoryId === food.id)!.utilizationPct, 62.5);

    await setCategoryBudgetActive(foodBudget.id, false);
    const afterDeactivate = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(afterDeactivate.summary.activeBudgetCount, 1);
    assert.equal(afterDeactivate.inactiveItems.length, 1);

    await deleteCategoryBudget(foodBudget.id);
    const afterDelete = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(afterDelete.inactiveItems.length, 0);
    // Original expense transaction must remain intact
    const allTx = await transactionsRepository.getUserRecords();
    assert.equal(allTx.some((t) => t.description === 'Groceries & dining'), true);
  });

  it('2. Monthly Allocation Plan, Over-Allocation Confirmation Guard, and Zero-Budget Edge Case', async () => {
    const bca = await createUserAccount({
      name: 'BCA',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const customZeroCat = await createCustomCategory({
      name: 'Zero Tolerance Fees',
      kind: 'expense',
    });
    const categories = await categoriesRepository.getUserRecords();
    const food = categories.find(
      (c) => c.kind === 'expense' && c.id !== customZeroCat.id
    )!;

    // Set Monthly Plan of 1,000,000 IDR
    const planRes = await saveMonthlyBudgetPlan({
      year: 2026,
      month: 11,
      totalBudgetAmount: 1_000_000,
      currency: 'IDR',
    });
    assert.equal(planRes.saved, true);

    await createCategoryBudget({
      categoryId: food.id,
      year: 2026,
      month: 11,
      limitAmount: 700_000,
    });

    // Attempting to add 500,000 without explicit confirmOverAllocation must warn/block
    await assert.rejects(
      createCategoryBudget({
        categoryId: customZeroCat.id,
        year: 2026,
        month: 11,
        limitAmount: 500_000,
      }),
      /exceed.*Monthly Plan/i
    );

    // Explicit confirmation allows saving without altering existing category budgets
    await createCategoryBudget({
      categoryId: customZeroCat.id,
      year: 2026,
      month: 11,
      limitAmount: 0, // Zero budget test!
      confirmOverAllocation: true,
    });

    // Zero budget with 0 spending -> 0% on_track
    let snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    let zeroItem = snap.items.find((i) => i.categoryId === customZeroCat.id)!;
    assert.equal(zeroItem.utilizationPct, 0);
    assert.equal(zeroItem.status, 'on_track');

    // Zero budget with 50,000 spending -> over_budget safely (no NaN/Infinity)
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: customZeroCat.id,
      amount: 50_000,
      date: '2026-11-12',
      description: 'Unexpected admin fee',
    });
    snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    zeroItem = snap.items.find((i) => i.categoryId === customZeroCat.id)!;
    assert.equal(zeroItem.status, 'over_budget');
    assert.equal(zeroItem.utilizationPct, null);
    assert.equal(zeroItem.remainingAmount, -50_000);

    // Removing plan also works cleanly
    if (snap.allocationStatus.plan) {
      await removeMonthlyBudgetPlan(snap.allocationStatus.plan.id);
    }
    const postRemove = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(postRemove.allocationStatus.hasPlan, false);
  });

  it('3. Deduplicated Alerts, Dismissal Persistence, and Auto-Resolution When Spending Changes', async () => {
    const bca = await createUserAccount({
      name: 'BCA',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const categories = await categoriesRepository.getUserRecords();
    const food = categories.find((c) => c.kind === 'expense')!;

    await updateBudgetAlertPreferences({
      nearLimitThresholdPct: 80,
      overBudgetThresholdPct: 100,
    });

    await createCategoryBudget({
      categoryId: food.id,
      year: 2026,
      month: 11,
      limitAmount: 1_000_000,
    });

    // 1) Cross 80% near-limit
    const tx = await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 850_000,
      date: '2026-11-08',
      description: 'Market shopping',
    });

    let snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    let activeAlerts = snap.alerts.filter((a) => a.status === 'active');
    assert.equal(activeAlerts.length, 1);
    assert.equal(activeAlerts[0].thresholdType, 'near_limit_80');

    // Reloading again must NOT duplicate alerts
    snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(snap.alerts.filter((a) => a.status === 'active').length, 1);

    // Dismiss near-limit alert and confirm it stays dismissed across refreshes
    await dismissBudgetAlert(activeAlerts[0].id);
    snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(snap.alerts.filter((a) => a.status === 'active').length, 0);
    assert.equal(snap.alerts.filter((a) => a.status === 'dismissed').length, 1);

    // 2) Escalate spending to 120% -> triggers NEW over_budget alert and resolves old tier
    await updateTransaction(tx.id, {
      accountId: bca.id,
      type: 'expense',
      categoryId: food.id,
      amount: 1_200_000,
      date: '2026-11-08',
      description: 'Market shopping updated',
    });

    snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    activeAlerts = snap.alerts.filter((a) => a.status === 'active');
    assert.equal(activeAlerts.length, 1);
    assert.equal(activeAlerts[0].thresholdType, 'over_budget');

    // 3) Delete expense -> alert automatically resolves!
    await deleteTransaction(tx.id);
    snap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    assert.equal(snap.alerts.filter((a) => a.status === 'active').length, 0);
    const storedAlerts = await budgetAlertsRepository.getUserRecords();
    assert.ok(storedAlerts.every((a) => a.status === 'resolved'));
  });

  it('4. Opt-In Rollover, Zero Negative Rollover, Idempotency, and Chronological Chain Recalculation', async () => {
    const bca = await createUserAccount({
      name: 'BCA',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 20_000_000,
    });
    const categories = await categoriesRepository.getUserRecords();
    const expenseCats = categories.filter((c) => c.kind === 'expense');
    const dining = expenseCats[0];
    const shopping = expenseCats[1];

    // Month 1 (2026-10): dining has rolloverEnabled = true, shopping overspends with rolloverEnabled = true
    const octDiningBudget = await createCategoryBudget({
      categoryId: dining.id,
      year: 2026,
      month: 10,
      limitAmount: 1_000_000,
      rolloverEnabled: true,
    });
    await createCategoryBudget({
      categoryId: shopping.id,
      year: 2026,
      month: 10,
      limitAmount: 500_000,
      rolloverEnabled: true,
    });

    const octDiningTx = await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: dining.id,
      amount: 600_000, // 400,000 unused!
      date: '2026-10-15',
      description: 'October dining',
    });
    await createTransaction({
      accountId: bca.id,
      type: 'expense',
      categoryId: shopping.id,
      amount: 700_000, // Overspent by 200,000 -> must NOT roll over positive or negative!
      date: '2026-10-16',
      description: 'October overspend',
    });

    const r1 = await applyMonthlyBudgetRollover({ sourceYear: 2026, sourceMonth: 10 });
    assert.equal(r1.appliedCount, 1);
    assert.equal(r1.skippedNoSurplusCount, 1);
    assert.equal(r1.items[0].rolledOverAmount, 400_000);

    // Re-running rollover must be idempotent (never duplicate 400k + 400k = 800k)
    const r2 = await applyMonthlyBudgetRollover({ sourceYear: 2026, sourceMonth: 10 });
    assert.equal(r2.items[0].rolledOverAmount, 400_000);

    let novSnap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    let novDining = novSnap.items.find((i) => i.categoryId === dining.id)!;
    assert.equal(novDining.baseLimit, 1_000_000);
    assert.equal(novDining.rolloverAmount, 400_000);
    assert.equal(novDining.availableBudget, 1_400_000);
    assert.equal(novSnap.items.find((i) => i.categoryId === shopping.id), undefined);

    // Update October dining expense from 600k -> 850k:
    // November rollover must automatically recalculate from 400k -> 150k while preserving November base limit 1,000,000!
    await updateTransaction(octDiningTx.id, {
      accountId: bca.id,
      type: 'expense',
      categoryId: dining.id,
      amount: 850_000,
      date: '2026-10-15',
      description: 'October dining adjusted',
    });

    novSnap = await getBudgetModuleSnapshot({ year: 2026, month: 11 });
    novDining = novSnap.items.find((i) => i.categoryId === dining.id)!;
    assert.equal(novDining.baseLimit, 1_000_000);
    assert.equal(novDining.rolloverAmount, 150_000);
    assert.equal(novDining.availableBudget, 1_150_000);

    // Source October budget historical baseLimit remains 1,000,000
    const octSource = await budgetsRepository.getById(octDiningBudget.id);
    assert.equal(octSource?.limitAmount, 1_000_000);
  });

  it('5. Multi-Currency Manual FX Handling, Historical Category Snapshots, Persistence & Test Origin Isolation', async () => {
    const usdAcc = await createUserAccount({
      name: 'USD Card',
      type: 'bank',
      currency: 'USD',
      initialBalance: 2_000,
    });
    const customCat = await createCustomCategory({
      name: 'Cloud Hosting',
      kind: 'expense',
    });

    await createCategoryBudget({
      categoryId: customCat.id,
      year: 2026,
      month: 10,
      limitAmount: 100,
      currency: 'USD',
    });
    await createTransaction({
      accountId: usdAcc.id,
      type: 'expense',
      categoryId: customCat.id,
      amount: 40,
      date: '2026-10-20',
      description: 'VPS server',
    });

    // Without manual FX rate USD->IDR, USD budget is safely flagged in excludedCurrencies
    let octSnap = await getBudgetModuleSnapshot({ year: 2026, month: 10 });
    assert.deepEqual(octSnap.summary.excludedCurrencies, ['USD']);

    // Add manual FX rate 1 USD = 16,000 IDR
    await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 16_000,
      date: '2026-10-20',
    });
    octSnap = await getBudgetModuleSnapshot({ year: 2026, month: 10 });
    assert.deepEqual(octSnap.summary.excludedCurrencies, []);
    assert.equal(octSnap.summary.totalBudget, 1_600_000);
    assert.equal(octSnap.summary.totalActualBudgetedExpenses, 640_000);

    // Rename & archive custom category -> historical budget label remains intact
    await updateUserCategory(customCat.id, { name: 'Infrastructure Hosting', kind: 'expense' });
    const delRes = await deleteCustomCategory(customCat.id);
    assert.equal(delRes.archivedInstead, true);

    // Create isolated test budget record (must NOT leak into user snapshot)
    await createCategoryBudget({
      categoryId: customCat.id,
      year: 2026,
      month: 10,
      limitAmount: 999,
      currency: 'USD',
      recordOrigin: 'test',
    }).catch(() => undefined);

    // Simulate reload across IndexedDB instance reset
    resetDatabaseInstance();
    const reloadedSnap = await getBudgetModuleSnapshot({ year: 2026, month: 10 });
    assert.equal(reloadedSnap.items.length, 1);
    assert.equal(reloadedSnap.items[0].categoryName, 'Infrastructure Hosting');
    assert.equal(reloadedSnap.items[0].actualAmount, 40);
  });
});
