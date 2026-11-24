import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { formatDisplayDate, getWeekStartDateString } from '@/lib/dates';
import {
  accountsRepository,
  budgetsRepository,
  categoriesRepository,
  preferencesRepository,
  transactionsRepository,
} from '@/repositories';
import { getAnalyticsSnapshot } from '@/services/analytics.service';
import {
  createAssetClass,
  deleteAssetClassSafely,
  listAssetClassesWithUsage,
  toggleAssetClassEnabled,
  updateAssetClass,
} from '@/services/asset-class.service';
import {
  exportDatabaseBackup,
  restoreDatabaseBackup,
  validateBackupJson,
} from '@/services/backup.service';
import { initializeApplication } from '@/services/bootstrap.service';
import { createCategoryBudget } from '@/services/budget.service';
import { verifyDexieMigrationProbe } from '@/services/health.service';
import { createHolding, ensureInvestmentPoolAccount } from '@/services/investment.service';
import {
  findManualFxRate,
  getManualFxRates,
  removeManualFxRateById,
  saveManualFxRate,
} from '@/services/portfolio-valuation.service';
import {
  clearAllApplicationData,
  createCustomCategory,
  createCustomInvestmentPlatform,
  createUserAccount,
  createUserSubcategory,
  deleteCustomCategory,
  deleteInvestmentPlatformSafely,
  deleteUserAccountSafely,
  deleteUserSubcategorySafely,
  getStorageAndDiagnostics,
  listUserAccountsWithBalances,
  listUserCategoriesWithCounts,
  listUserInvestmentPlatformsWithDetails,
  listUserSubcategories,
  toggleCategoryArchive,
  toggleInvestmentPlatformStatus,
  toggleUserAccountArchive,
  updateInvestmentPlatform,
  updateUserAccount,
  updateUserCategory,
  updateUserPreferences,
  updateUserProfile,
  updateUserSubcategory,
} from '@/services/settings.service';
import { createTransaction } from '@/services/transaction.service';

async function resetLocalDatabaseForTest(): Promise<string> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  const boot = await initializeApplication();
  return boot.installation.installationId;
}

describe('Stage 7 — Profile & Settings Refinement Engine & v7 Migration', () => {
  let installationId = '';

  beforeEach(async () => {
    resetDatabaseInstance();
    installationId = await resetLocalDatabaseForTest();
  });

  it('1. Personal Information & Preferences validation, persistence, formatting, and week-start logic', async () => {
    await assert.rejects(
      () =>
        updateUserProfile(installationId, {
          profileName: 'Adi',
          profileEmail: 'not-an-email',
          profileAvatar: '',
        }),
      /valid email/i
    );

    const savedProfile = await updateUserProfile(installationId, {
      profileName: 'Adi Pratama',
      profileEmail: 'adi@local.test',
      profileAvatar: 'data:image/jpeg;base64,testavatar',
      profileDescription: 'Household & personal investment ledger',
    });
    assert.equal(savedProfile.profileName, 'Adi Pratama');
    assert.equal(savedProfile.profileEmail, 'adi@local.test');
    assert.equal(savedProfile.profileAvatar, 'data:image/jpeg;base64,testavatar');
    assert.equal(savedProfile.profileDescription, 'Household & personal investment ledger');

    // Reset avatar
    const clearedAvatar = await updateUserProfile(installationId, {
      profileName: 'Adi Pratama',
      profileEmail: '',
      profileAvatar: '',
      profileDescription: 'Household & personal investment ledger',
    });
    assert.equal(clearedAvatar.profileAvatar, '');
    assert.equal(clearedAvatar.profileEmail, '');

    // Invalid timezone rejected
    await assert.rejects(
      () => updateUserPreferences(installationId, { timezone: 'Mars/Olympus_Mons' }),
      /Invalid IANA timezone/i
    );

    const updatedPrefs = await updateUserPreferences(installationId, {
      themePreference: 'dark',
      language: 'id',
      baseCurrency: 'USD',
      numberFormat: 'en-US',
      dateFormat: 'MM/DD/YYYY',
      firstDayOfWeek: 'sunday',
      timezone: 'Asia/Singapore',
      privacyMode: true,
    });

    assert.equal(updatedPrefs.themePreference, 'dark');
    assert.equal(updatedPrefs.language, 'id');
    assert.equal(updatedPrefs.baseCurrency, 'USD');
    assert.equal(updatedPrefs.locale, 'en-US');
    assert.equal(updatedPrefs.dateFormat, 'MM/DD/YYYY');
    assert.equal(updatedPrefs.firstDayOfWeek, 'sunday');
    assert.equal(updatedPrefs.timezone, 'Asia/Singapore');
    assert.equal(updatedPrefs.privacyMode, true);

    resetDatabaseInstance();
    const reopenedPreferences = (await initializeApplication()).preferences;
    assert.equal(reopenedPreferences.privacyMode, true, 'privacy preference survives database reopen');

    assert.equal(formatDisplayDate('2026-11-24', 'MM/DD/YYYY'), '11/24/2026');
    // 2026-11-25 is Wednesday: Sunday start -> 2026-11-22; Monday start -> 2026-11-23
    assert.equal(getWeekStartDateString('2026-11-25', 'sunday'), '2026-11-22');
    assert.equal(getWeekStartDateString('2026-11-25', 'monday'), '2026-11-23');
  });

  it('2. Accounts management: notes, opening balance recalculation, archive guards, pool uniqueness & safe delete', async () => {
    const bank = await createUserAccount({
      name: 'Mandiri Payroll',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 5_000_000,
      notes: 'Main salary checking account',
    });
    assert.equal(bank.notes, 'Main salary checking account');

    // Prevent manual investment_cash creation
    await assert.rejects(
      () =>
        createUserAccount({
          name: 'Manual Platform Cash',
          type: 'investment_cash',
          currency: 'IDR',
        }),
      /Platform Cash accounts are automatically created/i
    );

    // Ensure duplicate investment_pool in same currency is blocked
    await ensureInvestmentPoolAccount('IDR');
    await assert.rejects(
      () =>
        createUserAccount({
          name: 'Second IDR Pool',
          type: 'investment_pool',
          currency: 'IDR',
        }),
      /already exists/i
    );

    const cats = await categoriesRepository.getUserRecords();
    const food = cats.find((c) => c.kind === 'expense')!;
    await createTransaction({
      accountId: bank.id,
      type: 'expense',
      categoryId: food.id,
      amount: 1_000_000,
      date: '2026-11-10',
      description: 'Groceries',
    });

    // Updating opening balance cleanly updates derived current balance (6,000,000 - 1,000,000 = 5,000,000)
    await updateUserAccount(bank.id, {
      name: 'Mandiri Payroll Updated',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 6_000_000,
      notes: 'Updated payroll note',
      isArchived: false,
    });

    const balancesAfterEdit = await listUserAccountsWithBalances();
    const bankItem = balancesAfterEdit.find((b) => b.account.id === bank.id)!;
    assert.equal(bankItem.openingBalance, 6_000_000);
    assert.equal(bankItem.currentBalance, 5_000_000);
    assert.equal(bankItem.transactionCount, 1);

    // Deleting account with historical transactions is blocked
    await assert.rejects(() => deleteUserAccountSafely(bank.id), /cannot be deleted/i);

    // Archiving blocks new transactions while preserving historical transactions
    await toggleUserAccountArchive(bank.id, true);
    await assert.rejects(
      () =>
        createTransaction({
          accountId: bank.id,
          type: 'expense',
          categoryId: food.id,
          amount: 100_000,
          date: '2026-11-12',
          description: 'Blocked archived account expense',
        }),
      /archived/i
    );
    const archivedBankTx = await transactionsRepository.getUserRecords();
    assert.equal(archivedBankTx.length, 1);

    // Unused account can be safely deleted
    const unused = await createUserAccount({
      name: 'Temp Wallet',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 0,
    });
    await deleteUserAccountSafely(unused.id);
    const deletedLookup = await accountsRepository.getById(unused.id);
    assert.equal(deletedLookup, undefined);
  });

  it('3. Categories & Subcategories CRUD, icon persistence, transfer exclusion, and safe deletion/archiving', async () => {
    // Transfer kind must not be allowed in Settings categories
    await assert.rejects(
      () => createCustomCategory({ name: 'Internal', kind: 'transfer' }),
      /must be either Income or Expense/i
    );

    const customCat = await createCustomCategory({
      name: 'Medical & Dental',
      kind: 'expense',
      icon: 'heart',
    });
    assert.equal(customCat.icon, 'heart');

    // Create subcategories
    const subClinic = await createUserSubcategory({
      categoryId: customCat.id,
      name: 'Clinic Visits',
    });
    const subPharmacy = await createUserSubcategory({
      categoryId: customCat.id,
      name: 'Pharmacy',
    });

    await updateUserSubcategory(subClinic.id, { name: 'Specialist Clinic' });
    const subs = await listUserSubcategories(customCat.id);
    assert.equal(subs.length, 2);
    assert.ok(subs.some((s) => s.name === 'Specialist Clinic'));

    // Link transaction & budget to custom category & subcategory
    const wallet = await createUserAccount({
      name: 'Cash Wallet',
      type: 'cash',
      currency: 'IDR',
      initialBalance: 5_000_000,
    });
    const tx = await createTransaction({
      accountId: wallet.id,
      type: 'expense',
      categoryId: customCat.id,
      subcategoryId: subClinic.id,
      amount: 450_000,
      date: '2026-11-15',
      description: 'Dental checkup',
    });
    assert.equal(tx.subcategoryId, subClinic.id);

    const budget = await createCategoryBudget({
      categoryId: customCat.id,
      year: 2026,
      month: 11,
      limitAmount: 1_500_000,
      currency: 'IDR',
    });

    // Renaming category preserves transaction & budget categoryId references
    await updateUserCategory(customCat.id, {
      name: 'Healthcare',
      kind: 'expense',
      icon: 'heart',
    });
    const storedTx = await transactionsRepository.getById(tx.id);
    const storedBudget = await budgetsRepository.getById(budget.id);
    assert.equal(storedTx?.categoryId, customCat.id);
    assert.equal(storedBudget?.categoryId, customCat.id);

    // Deleting referenced subcategory archives it safely instead
    const subDelRes = await deleteUserSubcategorySafely(subClinic.id);
    assert.equal(subDelRes.archivedInstead, true);
    // Unreferenced subcategory deletes completely
    const subUnusedRes = await deleteUserSubcategorySafely(subPharmacy.id);
    assert.equal(subUnusedRes.archivedInstead, false);

    // Default category cannot be deleted
    const catList = await listUserCategoriesWithCounts();
    const defaultCat = catList.categories.find((c) => c.isDefault)!;
    await assert.rejects(() => deleteCustomCategory(defaultCat.id), /cannot be deleted/i);

    // Referenced custom category archives instead of deleting
    const catDelRes = await deleteCustomCategory(customCat.id);
    assert.equal(catDelRes.archivedInstead, true);
    const archivedCat = await categoriesRepository.getById(customCat.id);
    assert.equal(archivedCat?.isArchived, true);

    await toggleCategoryArchive(customCat.id, false);
    const restoredCat = await categoriesRepository.getById(customCat.id);
    assert.equal(restoredCat?.isArchived, false);
  });

  it('4. Investment Platforms & Asset Classes management with usage protection and cash preservation', async () => {
    const customPlatform = await createCustomInvestmentPlatform({
      name: 'Ajaib Sekuritas',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      supportsInvestmentPool: true,
    });
    assert.ok(customPlatform.cashAccountId);

    const customAc = await createAssetClass({
      name: 'Real Estate Trusts',
      code: 'REIT',
      description: 'Property and commercial REIT holdings',
    });
    assert.equal(customAc.code, 'REIT');

    // Update & toggle asset class
    await updateAssetClass(customAc.id, {
      name: 'Commercial REITs',
      description: 'Updated description',
    });
    await toggleAssetClassEnabled(customAc.id, false);
    let acUsage = await listAssetClassesWithUsage({ recordOrigin: 'user' });
    assert.equal(acUsage.find((a) => a.assetClass.id === customAc.id)?.assetClass.isArchived, true);
    await toggleAssetClassEnabled(customAc.id, true);

    // Attach holding to platform + asset class
    await createHolding({
      platformId: customPlatform.id,
      assetClassId: customAc.id,
      name: 'Indonesia REIT Fund',
      symbol: 'DIRE-IDX',
      currency: 'IDR',
      currentPrice: 1_000_000,
    });

    // Linked platform & asset class cannot be hard-deleted while holding exists
    await assert.rejects(() => deleteInvestmentPlatformSafely(customPlatform.id), /cannot be deleted/i);
    await assert.rejects(() => deleteAssetClassSafely(customAc.id), /cannot be deleted/i);

    // Disabling platform preserves linked cash account & holdings
    await toggleInvestmentPlatformStatus(customPlatform.id, true);
    const platDetails = await listUserInvestmentPlatformsWithDetails();
    const targetPlat = platDetails.find((p) => p.platform.id === customPlatform.id)!;
    assert.equal(targetPlat.platform.isArchived, true);
    assert.equal(targetPlat.holdingCount, 1);
    assert.ok(targetPlat.cashAccount);

    // Unused custom platform and unused asset class delete cleanly
    const tempPlat = await createCustomInvestmentPlatform({
      name: 'Unused Broker',
      kind: 'other',
      defaultCurrency: 'USD',
      supportsInvestmentPool: false,
    });
    await updateInvestmentPlatform(tempPlat.id, {
      name: 'Unused Broker Renamed',
      kind: 'brokerage',
      defaultCurrency: 'USD',
      supportsInvestmentPool: true,
      isArchived: false,
    });
    await deleteInvestmentPlatformSafely(tempPlat.id);

    const tempAc = await createAssetClass({ name: 'Collectibles', code: 'COLLECT' });
    await deleteAssetClassSafely(tempAc.id);
    acUsage = await listAssetClassesWithUsage({ recordOrigin: 'user' });
    assert.equal(acUsage.some((a) => a.assetClass.id === tempAc.id), false);
  });

  it('5. Historical FX rate preservation across dates & accurate analytics conversion without fabrication', async () => {
    const usdBank = await createUserAccount({
      name: 'USD Savings',
      type: 'bank',
      currency: 'USD',
      initialBalance: 0,
    });
    const eurBank = await createUserAccount({
      name: 'EUR Travel Account',
      type: 'bank',
      currency: 'EUR',
      initialBalance: 100,
    });

    const cats = await categoriesRepository.getUserRecords();
    const salary = cats.find((c) => c.kind === 'income')!;

    await createTransaction({
      accountId: usdBank.id,
      type: 'income',
      categoryId: salary.id,
      amount: 100,
      date: '2026-10-15',
      description: 'October USD consulting',
    });
    await createTransaction({
      accountId: usdBank.id,
      type: 'income',
      categoryId: salary.id,
      amount: 100,
      date: '2026-11-15',
      description: 'November USD consulting',
    });

    // Record October rate = 15,000 IDR, then November rate = 16,000 IDR, then update November to 16,500 IDR
    await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 15_000,
      date: '2026-10-01',
      notes: 'Oct closing',
    });
    await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 16_000,
      date: '2026-11-01',
      notes: 'Nov initial',
    });
    const ratesAfterNovUpdate = await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 16_500,
      date: '2026-11-01',
      notes: 'Nov revised',
    });

    assert.equal(ratesAfterNovUpdate.length, 2);
    assert.equal(findManualFxRate(ratesAfterNovUpdate, 'USD', 'IDR', '2026-10-15')?.rate, 15_000);
    assert.equal(findManualFxRate(ratesAfterNovUpdate, 'USD', 'IDR', '2026-11-15')?.rate, 16_500);

    // Verify Analytics converts Oct at 15,000 (= 1,500,000) and Nov at 16,500 (= 1,650,000), total = 3,150,000
    // And EUR (unrated) remains excluded rather than fabricated
    const octSnap = await getAnalyticsSnapshot({
      periodPreset: 'custom',
      customStart: '2026-10-01',
      customEnd: '2026-10-31',
      baseCurrency: 'IDR',
    });
    assert.equal(octSnap.income.totalIncome, 1_500_000);

    const bothMonthsSnap = await getAnalyticsSnapshot({
      periodPreset: 'custom',
      customStart: '2026-10-01',
      customEnd: '2026-11-30',
      baseCurrency: 'IDR',
    });
    assert.equal(bothMonthsSnap.income.totalIncome, 3_150_000);
    assert.ok(bothMonthsSnap.excludedCurrencies.includes('EUR'));
    assert.ok(eurBank.id);

    // Delete individual FX rate by ID
    const allRates = await getManualFxRates();
    await removeManualFxRateById(allRates[0].id!);
    assert.equal((await getManualFxRates()).length, 1);
  });

  it('6. Backup export/lastBackupAt, validation rejections, atomic rollback, clear data & v1->v8 migration', async () => {
    const wallet = await createUserAccount({
      name: 'Main Checking',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 2_500_000,
    });
    await updateUserProfile(installationId, {
      profileName: 'Backup Tester',
      profileEmail: 'tester@example.com',
      profileAvatar: '',
      profileDescription: 'Snapshot bio',
    });

    const exported = await exportDatabaseBackup();
    const prefsAfterExport = (await preferencesRepository.getAll())[0];
    assert.ok(prefsAfterExport?.lastBackupAt);

    const diagnostics = await getStorageAndDiagnostics();
    assert.equal(diagnostics.health.schemaVersion, APP_CONFIG.currentSchemaVersion);
    assert.ok(diagnostics.userRecordCounts.accounts >= 1);
    assert.ok(diagnostics.lastBackupAt);

    // Reject malformed, wrong-app, duplicate-id, corrupted FK, and future schemaVersion backups
    assert.equal(validateBackupJson('not json').valid, false);
    assert.equal(
      validateBackupJson(JSON.stringify({ ...exported.envelope, schemaVersion: 99 })).valid,
      false
    );

    const corruptedTxEnvelope = structuredClone(exported.envelope);
    corruptedTxEnvelope.tables.transactions.push({
      id: 'tx_broken_fk',
      accountId: 'non_existent_account',
      type: 'expense',
      amount: 1000,
      currency: 'IDR',
      date: '2026-11-01',
      description: 'Broken FK',
      status: 'posted',
      isTestData: false,
      recordOrigin: 'user',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    assert.equal(validateBackupJson(JSON.stringify(corruptedTxEnvelope)).valid, false);

    // Verify atomic restore succeeds & restores modified state cleanly
    await clearAllApplicationData();
    const clearedAccounts = await accountsRepository.getUserRecords();
    assert.equal(clearedAccounts.some((a) => a.id === wallet.id), false);

    const validatedBackup = validateBackupJson(exported.jsonString);
    assert.equal(validatedBackup.valid, true);
    const restoreResult = await restoreDatabaseBackup(validatedBackup.envelope!);
    assert.ok(restoreResult.totalRestoredRecords > 0);
    const restoredWallet = await accountsRepository.getById(wallet.id);
    assert.equal(restoredWallet?.name, 'Main Checking');

    // Verify atomic rollback if bulkAdd fails mid-transaction (prior DB state must survive intact)
    const db = await ensureDatabaseOpen();
    const accountsTable = db.table('accounts');
    const originalBulkAdd = accountsTable.bulkAdd.bind(accountsTable);
    accountsTable.bulkAdd = (() =>
      Promise.reject(
        new Error('Simulated mid-restore IndexedDB write failure')
      )) as typeof accountsTable.bulkAdd;
    try {
      await assert.rejects(
        () => restoreDatabaseBackup(validatedBackup.envelope!),
        /Simulated mid-restore IndexedDB write failure/
      );
    } finally {
      accountsTable.bulkAdd = originalBulkAdd;
    }
    const intactAfterRollback = await accountsRepository.getById(wallet.id);
    assert.equal(intactAfterRollback?.name, 'Main Checking');

    // Verify migration probe v1 -> v8 passes
    const migration = await verifyDexieMigrationProbe();
    assert.equal(migration.passed, true);
    assert.equal(migration.testedToVersion, 8);
  });
});
