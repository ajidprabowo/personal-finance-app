import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { nowIso } from '@/lib/dates';
import { SafetyGuardError, ValidationError } from '@/lib/errors';
import {
  accountsRepository,
  budgetsRepository,
  categoriesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  investmentPlatformsRepository,
  preferencesRepository,
  subcategoriesRepository,
  transactionsRepository,
} from '@/repositories';
import {
  calculateAccountBalances,
  type AccountBalanceItem,
} from '@/services/account-balance.service';
import { initializeApplication } from '@/services/bootstrap.service';
import { getDatabaseHealthSummary } from '@/services/health.service';
import type { DatabaseHealthSummary } from '@/types/database';
import type {
  Account,
  AccountType,
  Category,
  CategoryKind,
  Holding,
  InvestmentPlatform,
  PlatformKind,
  Subcategory,
  UserPreferences,
} from '@/types/entities';

export interface ProfileUpdateInput {
  profileName: string;
  profileEmail: string;
  profileAvatar: string;
  profileDescription?: string;
}

export type PreferencesUpdateInput = Partial<
  Pick<
    UserPreferences,
    | 'themePreference'
    | 'baseCurrency'
    | 'locale'
    | 'numberFormat'
    | 'dateFormat'
    | 'firstDayOfWeek'
    | 'language'
    | 'timezone'
  >
>;

export async function updateUserProfile(
  installationId: string,
  input: ProfileUpdateInput
): Promise<UserPreferences> {
  const prefs = await preferencesRepository.getByInstallationId(installationId);
  if (!prefs) {
    throw new ValidationError('User preferences record not found for current installation.');
  }

  const trimmedEmail = input.profileEmail.trim();
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new ValidationError('Please enter a valid email address or leave it blank.');
  }

  const trimmedDescription =
    input.profileDescription !== undefined
      ? input.profileDescription.trim()
      : prefs.profileDescription ?? '';

  return preferencesRepository.update(prefs.id, {
    profileName: input.profileName.trim(),
    profileEmail: trimmedEmail,
    profileAvatar: input.profileAvatar,
    profileDescription: trimmedDescription,
  });
}

function validateTimezone(timezone: string): string {
  const tz = timezone.trim();
  if (!tz) {
    throw new ValidationError('Timezone is required.');
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    throw new ValidationError(`Invalid IANA timezone "${tz}".`);
  }
}

export async function updateUserPreferences(
  installationId: string,
  patch: PreferencesUpdateInput
): Promise<UserPreferences> {
  const prefs = await preferencesRepository.getByInstallationId(installationId);
  if (!prefs) {
    throw new ValidationError('User preferences record not found for current installation.');
  }

  const sanitizedPatch: PreferencesUpdateInput = { ...patch };

  if (sanitizedPatch.baseCurrency !== undefined) {
    const code = sanitizedPatch.baseCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new ValidationError('Default currency must be a valid 3-letter ISO currency code.');
    }
    sanitizedPatch.baseCurrency = code;
  }

  if (sanitizedPatch.timezone !== undefined) {
    sanitizedPatch.timezone = validateTimezone(sanitizedPatch.timezone);
  }

  if (
    sanitizedPatch.themePreference !== undefined &&
    sanitizedPatch.themePreference !== 'light' &&
    sanitizedPatch.themePreference !== 'dark' &&
    sanitizedPatch.themePreference !== 'system'
  ) {
    throw new ValidationError('Theme must be light, dark, or system.');
  }

  if (
    sanitizedPatch.language !== undefined &&
    sanitizedPatch.language !== 'en' &&
    sanitizedPatch.language !== 'id'
  ) {
    throw new ValidationError('Language must be English (en) or Indonesian (id).');
  }

  if (
    sanitizedPatch.firstDayOfWeek !== undefined &&
    sanitizedPatch.firstDayOfWeek !== 'monday' &&
    sanitizedPatch.firstDayOfWeek !== 'sunday'
  ) {
    throw new ValidationError('First day of week must be monday or sunday.');
  }

  const nextLocale =
    sanitizedPatch.numberFormat === 'en-US'
      ? 'en-US'
      : sanitizedPatch.numberFormat === 'id-ID'
        ? 'id-ID'
        : prefs.locale;

  return preferencesRepository.update(prefs.id, {
    ...sanitizedPatch,
    locale: sanitizedPatch.locale ?? nextLocale,
  });
}

// Accounts Management
export async function listUserAccounts(): Promise<Account[]> {
  const accounts = await accountsRepository.getUserRecords();
  return accounts.sort((a, b) => a.name.localeCompare(b.name));
}

export interface UserAccountWithBalance extends AccountBalanceItem {
  transactionCount: number;
}

export async function listUserAccountsWithBalances(): Promise<UserAccountWithBalance[]> {
  const [accounts, transactions, activities] = await Promise.all([
    accountsRepository.getUserRecords(),
    transactionsRepository.getUserRecords(),
    investmentActivitiesRepository.getUserRecords(),
  ]);

  const sorted = [...accounts].sort((a, b) => a.name.localeCompare(b.name));
  const summary = calculateAccountBalances(sorted, transactions, activities);
  const txCounts = new Map<string, number>();

  for (const tx of transactions) {
    txCounts.set(tx.accountId, (txCounts.get(tx.accountId) ?? 0) + 1);
    if (tx.toAccountId && tx.toAccountId !== tx.accountId) {
      txCounts.set(tx.toAccountId, (txCounts.get(tx.toAccountId) ?? 0) + 1);
    }
  }

  return summary.items.map((item) => ({
    ...item,
    transactionCount: txCounts.get(item.account.id) ?? 0,
  }));
}

export async function createUserAccount(input: {
  name: string;
  type: AccountType;
  currency: string;
  initialBalance?: number;
  notes?: string;
  isArchived?: boolean;
}): Promise<Account> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Account name is required.');
  }
  if (input.type === 'investment_cash') {
    throw new ValidationError(
      'Platform Cash accounts are automatically created and linked when adding an Investment Platform.'
    );
  }

  const currency = (input.currency || APP_CONFIG.defaultCurrency).toUpperCase();
  const initialBalance = roundCurrencyAmount(Number(input.initialBalance ?? 0) || 0, currency);

  if (input.type === 'investment_pool') {
    const existingAccounts = await accountsRepository.getUserRecords();
    const existingPool = existingAccounts.find(
      (a) =>
        (a.type === 'investment_pool' || a.isInvestmentPool) &&
        a.currency.toUpperCase() === currency
    );
    if (existingPool) {
      throw new ValidationError(
        `An Investment Pool account in ${currency} ("${existingPool.name}") already exists. Keep one canonical pool per currency to prevent double-counting.`
      );
    }
  }

  return accountsRepository.create({
    name,
    type: input.type,
    currency,
    initialBalance,
    notes: input.notes?.trim() || undefined,
    isInvestmentPool: input.type === 'investment_pool',
    isArchived: Boolean(input.isArchived),
    isTestData: false,
    recordOrigin: 'user',
  });
}

export async function updateUserAccount(
  id: string,
  patch: {
    name: string;
    type: AccountType;
    currency: string;
    initialBalance?: number;
    notes?: string;
    isArchived: boolean;
  }
): Promise<Account> {
  const existing = await accountsRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Account not found.');
  }
  const name = patch.name.trim();
  if (!name) {
    throw new ValidationError('Account name is required.');
  }

  if (existing.type === 'investment_cash' && existing.platformId && patch.type !== 'investment_cash') {
    throw new SafetyGuardError(
      'Linked Platform Cash accounts must keep the Platform Cash account type.'
    );
  }
  if (existing.type !== 'investment_cash' && patch.type === 'investment_cash') {
    throw new ValidationError(
      'Cannot convert a regular account into a Platform Cash account without a linked platform.'
    );
  }

  const nextCurrency = patch.currency.toUpperCase();
  if (nextCurrency !== existing.currency) {
    const linkedTxCount = await transactionsRepository.countByAccountInvolvement(id);
    if (linkedTxCount > 0) {
      throw new SafetyGuardError(
        `Cannot change currency of "${existing.name}" because it has ${linkedTxCount} historical transaction(s).`
      );
    }
  }

  if (patch.type === 'investment_pool') {
    const existingAccounts = await accountsRepository.getUserRecords();
    const conflictingPool = existingAccounts.find(
      (a) =>
        a.id !== id &&
        (a.type === 'investment_pool' || a.isInvestmentPool) &&
        a.currency.toUpperCase() === nextCurrency
    );
    if (conflictingPool) {
      throw new ValidationError(
        `Another Investment Pool account in ${nextCurrency} ("${conflictingPool.name}") already exists.`
      );
    }
  }

  const nextInitialBalance =
    patch.initialBalance !== undefined
      ? roundCurrencyAmount(Number(patch.initialBalance) || 0, nextCurrency)
      : existing.initialBalance;

  return accountsRepository.update(id, {
    name,
    type: patch.type,
    currency: nextCurrency,
    initialBalance: nextInitialBalance,
    notes: patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
    isInvestmentPool: patch.type === 'investment_pool',
    isArchived: patch.isArchived,
  });
}

export async function toggleUserAccountArchive(id: string, isArchived: boolean): Promise<Account> {
  const existing = await accountsRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Account not found.');
  }
  return accountsRepository.update(id, { isArchived });
}

export async function deleteUserAccountSafely(id: string): Promise<void> {
  const existing = await accountsRepository.getById(id);
  if (!existing) return;
  if (existing.recordOrigin === 'test') {
    throw new SafetyGuardError('Test accounts must be deleted from the Stage 1 verification console.');
  }
  if (existing.type === 'investment_cash' && existing.platformId) {
    throw new SafetyGuardError(
      `Account "${existing.name}" is linked to an Investment Platform and cannot be deleted directly.`
    );
  }

  const linkedTxCount = await transactionsRepository.countByAccountInvolvement(id);
  if (linkedTxCount > 0) {
    throw new SafetyGuardError(
      `Account "${existing.name}" has ${linkedTxCount} historical transaction(s) and cannot be deleted. Archive it instead to preserve transaction history.`
    );
  }

  await accountsRepository.delete(id);
}

// Categories & Subcategories Management
export async function listUserCategoriesWithCounts(): Promise<{
  categories: Category[];
  subcategoryCounts: Record<string, number>;
  subcategories: Subcategory[];
}> {
  const [categories, subcategories] = await Promise.all([
    categoriesRepository.getUserRecords(),
    subcategoriesRepository.getUserRecords(),
  ]);

  const subcategoryCounts: Record<string, number> = {};
  for (const sub of subcategories) {
    subcategoryCounts[sub.categoryId] = (subcategoryCounts[sub.categoryId] ?? 0) + 1;
  }

  return {
    categories: categories
      .filter((c) => c.kind === 'income' || c.kind === 'expense')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    subcategoryCounts,
    subcategories: [...subcategories].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function createCustomCategory(input: {
  name: string;
  kind: CategoryKind;
  icon?: string;
}): Promise<Category> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Category name is required.');
  }
  if (input.kind !== 'income' && input.kind !== 'expense') {
    throw new ValidationError('Categories in Settings must be either Income or Expense.');
  }

  const existing = await categoriesRepository.getUserRecords();
  const duplicate = existing.find(
    (c) => c.kind === input.kind && c.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    throw new ValidationError(`Category "${name}" (${input.kind}) already exists.`);
  }

  return categoriesRepository.create({
    name,
    kind: input.kind,
    icon: input.icon?.trim() || 'tag',
    sortOrder: existing.length + 1,
    isDefault: false,
    isArchived: false,
    isTestData: false,
    recordOrigin: 'user',
  });
}

export async function updateUserCategory(
  id: string,
  patch: { name: string; kind: CategoryKind; icon?: string; isArchived?: boolean }
): Promise<Category> {
  const existing = await categoriesRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Category not found.');
  }
  const name = patch.name.trim();
  if (!name) {
    throw new ValidationError('Category name is required.');
  }
  if (patch.kind !== 'income' && patch.kind !== 'expense') {
    throw new ValidationError('Categories in Settings must be either Income or Expense.');
  }

  if (patch.kind !== existing.kind) {
    const [txCount, budgets] = await Promise.all([
      transactionsRepository.countByCategoryId(id),
      budgetsRepository.getUserRecords(),
    ]);
    const budgetCount = budgets.filter((b) => b.categoryId === id).length;
    if (txCount > 0 || budgetCount > 0) {
      throw new SafetyGuardError(
        `Cannot change category type of "${existing.name}" because it has ${txCount} transaction(s) and ${budgetCount} budget(s).`
      );
    }
  }

  return categoriesRepository.update(id, {
    name,
    kind: patch.kind,
    ...(patch.icon !== undefined ? { icon: patch.icon.trim() || 'tag' } : {}),
    ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
  });
}

export async function toggleCategoryArchive(id: string, isArchived: boolean): Promise<Category> {
  const existing = await categoriesRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Category not found.');
  }
  return categoriesRepository.update(id, { isArchived });
}

export async function deleteCustomCategory(id: string): Promise<{ archivedInstead: boolean }> {
  const existing = await categoriesRepository.getById(id);
  if (!existing) return { archivedInstead: false };

  if (existing.isDefault) {
    throw new SafetyGuardError(
      `Default category "${existing.name}" cannot be deleted. You may rename or archive it instead.`
    );
  }
  if (existing.recordOrigin === 'test') {
    throw new SafetyGuardError('Test records must be managed from the Stage 1 verification console.');
  }

  const [referencedTxCount, budgets, subcategories] = await Promise.all([
    transactionsRepository.countByCategoryId(id),
    budgetsRepository.getUserRecords(),
    subcategoriesRepository.getByCategoryId(id),
  ]);
  const referencedBudgetCount = budgets.filter((b) => b.categoryId === id).length;

  if (referencedTxCount > 0 || referencedBudgetCount > 0) {
    // Preserve historical transaction and budget integrity by archiving instead of hard-deleting
    await categoriesRepository.update(id, { isArchived: true });
    return { archivedInstead: true };
  }

  const db = await ensureDatabaseOpen();
  await db.transaction('rw', [db.categories, db.subcategories], async () => {
    for (const sub of subcategories) {
      await db.subcategories.delete(sub.id);
    }
    await db.categories.delete(id);
  });
  return { archivedInstead: false };
}

export async function listUserSubcategories(categoryId?: string): Promise<Subcategory[]> {
  const subs = categoryId
    ? await subcategoriesRepository.getByCategoryId(categoryId)
    : await subcategoriesRepository.getUserRecords();
  return subs
    .filter((s) => s.recordOrigin === 'user')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createUserSubcategory(input: {
  categoryId: string;
  name: string;
}): Promise<Subcategory> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Subcategory name is required.');
  }
  const category = await categoriesRepository.getById(input.categoryId);
  if (!category || category.recordOrigin === 'test') {
    throw new ValidationError('Parent category not found.');
  }
  if (category.kind !== 'income' && category.kind !== 'expense') {
    throw new ValidationError('Subcategories can only belong to Income or Expense categories.');
  }

  const siblings = await subcategoriesRepository.getByCategoryId(input.categoryId);
  const duplicate = siblings.find(
    (s) => s.recordOrigin === 'user' && s.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    throw new ValidationError(`Subcategory "${name}" already exists under "${category.name}".`);
  }

  return subcategoriesRepository.create({
    categoryId: input.categoryId,
    name,
    sortOrder: siblings.length + 1,
    isArchived: false,
    isTestData: false,
    recordOrigin: 'user',
  });
}

export async function updateUserSubcategory(
  id: string,
  patch: { name: string; isArchived?: boolean }
): Promise<Subcategory> {
  const existing = await subcategoriesRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Subcategory not found.');
  }
  const name = patch.name.trim();
  if (!name) {
    throw new ValidationError('Subcategory name is required.');
  }

  const siblings = await subcategoriesRepository.getByCategoryId(existing.categoryId);
  const duplicate = siblings.find(
    (s) => s.id !== id && s.recordOrigin === 'user' && s.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    throw new ValidationError(`Another subcategory named "${name}" already exists in this category.`);
  }

  return subcategoriesRepository.update(id, {
    name,
    ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
  });
}

export async function deleteUserSubcategorySafely(
  id: string
): Promise<{ archivedInstead: boolean }> {
  const existing = await subcategoriesRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    return { archivedInstead: false };
  }

  const txs = await transactionsRepository.getUserRecords();
  const refCount = txs.filter((t) => t.subcategoryId === id).length;

  if (refCount > 0) {
    await subcategoriesRepository.update(id, { isArchived: true });
    return { archivedInstead: true };
  }

  await subcategoriesRepository.delete(id);
  return { archivedInstead: false };
}

// Investment Platforms Management
export async function listUserInvestmentPlatforms(): Promise<InvestmentPlatform[]> {
  const platforms = await investmentPlatformsRepository.getUserRecords();
  return platforms.sort((a, b) => a.name.localeCompare(b.name));
}

export interface InvestmentPlatformWithDetails {
  platform: InvestmentPlatform;
  cashAccount: Account | null;
  cashBalance: number;
  holdingCount: number;
  activeHoldingCount: number;
  holdings: Holding[];
  activityCount: number;
}

export async function listUserInvestmentPlatformsWithDetails(): Promise<
  InvestmentPlatformWithDetails[]
> {
  const [platforms, accounts, transactions, activities, holdings] = await Promise.all([
    investmentPlatformsRepository.getUserRecords(),
    accountsRepository.getUserRecords(),
    transactionsRepository.getUserRecords(),
    investmentActivitiesRepository.getUserRecords(),
    holdingsRepository.getUserRecords(),
  ]);

  const balanceSnapshot = calculateAccountBalances(accounts, transactions, activities);
  const balanceByAccountId = new Map(
    balanceSnapshot.items.map((item) => [item.account.id, item])
  );

  return platforms
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((platform) => {
      const linkedCash = platform.cashAccountId
        ? balanceByAccountId.get(platform.cashAccountId)
        : undefined;
      const platformHoldings = holdings.filter((h) => h.platformId === platform.id);
      const activityCount = activities.filter((a) => a.platformId === platform.id).length;
      return {
        platform,
        cashAccount: linkedCash?.account ?? null,
        cashBalance: linkedCash?.currentBalance ?? 0,
        holdingCount: platformHoldings.length,
        activeHoldingCount: platformHoldings.filter((h) => h.quantity > 0 && !h.isArchived).length,
        holdings: platformHoldings.sort(
          (a, b) => (b.currentMarketValue ?? 0) - (a.currentMarketValue ?? 0)
        ),
        activityCount,
      };
    });
}

export async function createCustomInvestmentPlatform(input: {
  name: string;
  kind: PlatformKind;
  defaultCurrency: string;
  supportsInvestmentPool: boolean;
}): Promise<InvestmentPlatform> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Platform name is required.');
  }

  const currency = (input.defaultCurrency || APP_CONFIG.defaultCurrency).toUpperCase();
  const existingPlatforms = await investmentPlatformsRepository.getUserRecords();
  const duplicate = existingPlatforms.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    throw new ValidationError(`Investment platform "${name}" already exists.`);
  }

  const db = await ensureDatabaseOpen();
  const timestamp = nowIso();
  const platformId = crypto.randomUUID();
  const cashAccountId = `acc_cash_${platformId}`;

  return db.transaction('rw', [db.investmentPlatforms, db.accounts], async () => {
    await db.accounts.add({
      id: cashAccountId,
      name: `${name} Cash`,
      type: 'investment_cash',
      currency,
      initialBalance: 0,
      platformId,
      isInvestmentPool: false,
      isArchived: false,
      notes: `Platform cash account for ${name}.`,
      isTestData: false,
      recordOrigin: 'user',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const platform: InvestmentPlatform = {
      id: platformId,
      name,
      kind: input.kind,
      defaultCurrency: currency,
      cashAccountId,
      supportsInvestmentPool: input.supportsInvestmentPool,
      isDefault: false,
      isArchived: false,
      isTestData: false,
      recordOrigin: 'user',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.investmentPlatforms.add(platform);
    return platform;
  });
}

export async function updateInvestmentPlatform(
  id: string,
  patch: {
    name: string;
    kind: PlatformKind;
    defaultCurrency: string;
    supportsInvestmentPool: boolean;
    isArchived: boolean;
  }
): Promise<InvestmentPlatform> {
  const existing = await investmentPlatformsRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Investment platform not found.');
  }
  const name = patch.name.trim();
  if (!name) {
    throw new ValidationError('Platform name is required.');
  }

  const nextCurrency = patch.defaultCurrency.toUpperCase();
  const db = await ensureDatabaseOpen();
  const timestamp = nowIso();

  return db.transaction(
    'rw',
    [db.investmentPlatforms, db.accounts, db.transactions, db.investmentActivities],
    async () => {
      if (existing.cashAccountId) {
        const cashAcc = await db.accounts.get(existing.cashAccountId);
        if (cashAcc && cashAcc.currency !== nextCurrency) {
          const linkedTx = await db.transactions
            .where('accountId')
            .equals(cashAcc.id)
            .or('toAccountId')
            .equals(cashAcc.id)
            .count();
          const linkedActs = await db.investmentActivities
            .where('platformId')
            .equals(id)
            .count();
          if (linkedTx > 0 || linkedActs > 0) {
            throw new SafetyGuardError(
              `Cannot change default currency of "${existing.name}" because it already has historical activity.`
            );
          }
        }
        if (cashAcc) {
          await db.accounts.update(cashAcc.id, {
            name: `${name} Cash`,
            currency: nextCurrency,
            isArchived: patch.isArchived,
            updatedAt: timestamp,
          });
        }
      }

      const updated: InvestmentPlatform = {
        ...existing,
        name,
        kind: patch.kind,
        defaultCurrency: nextCurrency,
        supportsInvestmentPool: patch.supportsInvestmentPool,
        isArchived: patch.isArchived,
        updatedAt: timestamp,
      };
      await db.investmentPlatforms.put(updated);
      return updated;
    }
  );
}

export async function toggleInvestmentPlatformStatus(
  id: string,
  isArchived: boolean
): Promise<InvestmentPlatform> {
  const existing = await investmentPlatformsRepository.getById(id);
  if (!existing || existing.recordOrigin === 'test') {
    throw new ValidationError('Investment platform not found.');
  }
  const updated = await investmentPlatformsRepository.update(id, { isArchived });
  if (existing.cashAccountId) {
    await accountsRepository.update(existing.cashAccountId, { isArchived }).catch(() => undefined);
  }
  return updated;
}

export async function deleteInvestmentPlatformSafely(id: string): Promise<void> {
  const existing = await investmentPlatformsRepository.getById(id);
  if (!existing) return;
  if (existing.recordOrigin === 'test') {
    throw new SafetyGuardError('Test platforms must be managed in the Stage 1 verification console.');
  }
  if (existing.isDefault) {
    throw new SafetyGuardError(
      `Default platform "${existing.name}" cannot be deleted. Disable or archive it instead.`
    );
  }

  const [holdings, activities, cashTxCount] = await Promise.all([
    holdingsRepository.getUserRecords(),
    investmentActivitiesRepository.getUserRecords(),
    existing.cashAccountId
      ? transactionsRepository.countByAccountInvolvement(existing.cashAccountId)
      : Promise.resolve(0),
  ]);

  const linkedHoldings = holdings.filter((h) => h.platformId === id).length;
  const linkedActivities = activities.filter((a) => a.platformId === id).length;

  if (linkedHoldings > 0 || linkedActivities > 0 || cashTxCount > 0) {
    throw new SafetyGuardError(
      `Platform "${existing.name}" has historical holdings (${linkedHoldings}), activities (${linkedActivities}), or cash transactions (${cashTxCount}) and cannot be deleted. Archive or disable it instead.`
    );
  }

  const db = await ensureDatabaseOpen();
  await db.transaction('rw', [db.investmentPlatforms, db.accounts], async () => {
    if (existing.cashAccountId) {
      await db.accounts.delete(existing.cashAccountId);
    }
    await db.investmentPlatforms.delete(id);
  });
}

// Storage & Diagnostics
export interface StorageDiagnosticsSnapshot {
  health: DatabaseHealthSummary;
  indexedDbAvailable: boolean;
  storageEstimate: {
    available: boolean;
    usageBytes: number | null;
    quotaBytes: number | null;
  };
  userRecordCounts: {
    transactions: number;
    investmentActivities: number;
    accounts: number;
    budgets: number;
    categories: number;
    subcategories: number;
    holdings: number;
    valuations: number;
  };
  lastBackupAt: string | null;
}

export async function getStorageAndDiagnostics(): Promise<StorageDiagnosticsSnapshot> {
  const [health, prefsList] = await Promise.all([
    getDatabaseHealthSummary(),
    preferencesRepository.getAll(),
  ]);

  const tableCount = (table: string): number =>
    health.tables.find((t) => t.table === table)?.userCount ?? 0;

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let estimateAvailable = false;

  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.estimate === 'function'
  ) {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = typeof est.usage === 'number' ? est.usage : null;
      quotaBytes = typeof est.quota === 'number' ? est.quota : null;
      estimateAvailable = usageBytes !== null || quotaBytes !== null;
    } catch {
      estimateAvailable = false;
    }
  }

  return {
    health,
    indexedDbAvailable: typeof globalThis.indexedDB !== 'undefined',
    storageEstimate: {
      available: estimateAvailable,
      usageBytes,
      quotaBytes,
    },
    userRecordCounts: {
      transactions: tableCount('transactions'),
      investmentActivities: tableCount('investmentActivities'),
      accounts: tableCount('accounts'),
      budgets: tableCount('budgets'),
      categories: tableCount('categories'),
      subcategories: tableCount('subcategories'),
      holdings: tableCount('holdings'),
      valuations: tableCount('portfolioValuations'),
    },
    lastBackupAt: prefsList[0]?.lastBackupAt ?? null,
  };
}

/**
 * Destructive reset triggered only after explicit user confirmation in Profile -> Storage & Backup.
 * Clears all IndexedDB tables and cleanly re-initializes a fresh installation & default taxonomy.
 */
export async function clearAllApplicationData(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('pfa_theme_hint');
    } catch {
      // Ignore storage access restrictions
    }
  }
  await initializeApplication();
}

