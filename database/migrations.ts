import type { Transaction as DexieTransaction } from 'dexie';
import { DEFAULT_ASSET_CLASSES, DEFAULT_INCOME_CATEGORIES } from '@/database/schema';
import { DEFAULT_CATEGORY_ICON_MAP } from '@/lib/category-icons';
import { APP_CONFIG } from '@/lib/config';
import { nowIso } from '@/lib/dates';
import type { MigrationRecord } from '@/types/database';
import { DATABASE_TABLES } from '@/types/database';

export const MIGRATION_HISTORY: MigrationRecord[] = [
  {
    version: 1,
    name: 'Initial 14-Table Local Vault Schema',
    description:
      'Establishes installation identity, preferences, cashflow accounts, categories, subcategories, transactions, budgets, investment entities, and future Gmail integration tables.',
    backwardCompatible: true,
    tablesAffected: [...DATABASE_TABLES],
  },
  {
    version: 2,
    name: 'Extensible Indexes & Investment Pool Readiness',
    description:
      'Adds compound date/origin indexes, linked transfer group indexes, platform/pool references, and normalizes recordOrigin tags on legacy v1 rows without altering existing financial data.',
    backwardCompatible: true,
    tablesAffected: [
      'appInstallation',
      'accounts',
      'transactions',
      'budgets',
      'assetClasses',
      'holdings',
      'investmentActivities',
      'portfolioValuations',
      'emailImportHistory',
    ],
  },
  {
    version: 3,
    name: 'Design System Preferences, Profile Metadata & Default Taxonomy',
    description:
      'Extends preferences with System/Light/Dark theme support, Indonesian/international number & date formats, language, timezone, and local profile fields without resetting existing records.',
    backwardCompatible: true,
    tablesAffected: ['appInstallation', 'preferences', 'categories', 'investmentPlatforms'],
  },
  {
    version: 4,
    name: 'Transaction Compound Indexes & Default Income Categories',
    description:
      'Adds compound transaction indexes ([recordOrigin+type], [recordOrigin+accountId]) for efficient filtered ledger queries and seeds default income categories if none exist.',
    backwardCompatible: true,
    tablesAffected: ['appInstallation', 'transactions', 'categories'],
  },
  {
    version: 5,
    name: 'Investment Portfolio Engine, Asset Classes & Platform Cash Accounts',
    description:
      'Adds investment query indexes, seeds default asset classes (Indo Stock, US Stock, Crypto, Gold), ensures default Investment Pool account, and provisions linked platform cash accounts.',
    backwardCompatible: true,
    tablesAffected: [
      'appInstallation',
      'accounts',
      'investmentPlatforms',
      'assetClasses',
      'holdings',
      'investmentActivities',
      'portfolioValuations',
    ],
  },
  {
    version: 6,
    name: 'Budget Management, Monthly Allocation Plans & Deduplicated Budget Alerts',
    description:
      'Adds monthlyBudgetPlans and budgetAlerts tables, compound budget period indexes, historical category snapshots, rollover tracking, and default alert thresholds without altering existing records.',
    backwardCompatible: true,
    tablesAffected: ['appInstallation', 'preferences', 'budgets', 'monthlyBudgetPlans', 'budgetAlerts'],
  },
  {
    version: 7,
    name: 'Profile Refinement, Category Icons & Dated FX Rate Preservation',
    description:
      'Extends preferences with optional profile description, backup timestamp, and dated FX rate metadata, and assigns default icon identifiers to existing categories while preserving all user data.',
    backwardCompatible: true,
    tablesAffected: ['appInstallation', 'preferences', 'categories'],
  },
  {
    version: 8,
    name: 'Manual Holding Price History',
    description:
      'Separates recorded market prices from buy and sell execution prices and backfills historical manual valuation entries.',
    backwardCompatible: true,
    tablesAffected: ['appInstallation', 'holdings', 'investmentActivities', 'portfolioValuations'],
  },
];

const TEST_TAGGED_TABLES = [
  'accounts',
  'categories',
  'subcategories',
  'transactions',
  'budgets',
  'investmentPlatforms',
  'assetClasses',
  'holdings',
  'investmentActivities',
  'portfolioValuations',
] as const;

export async function upgradeV1ToV2(tx: DexieTransaction): Promise<void> {
  for (const tableName of TEST_TAGGED_TABLES) {
    await tx
      .table(tableName)
      .toCollection()
      .modify((record: Record<string, unknown>) => {
        if (typeof record.isTestData !== 'boolean') {
          record.isTestData = false;
        }
        if (record.recordOrigin !== 'test' && record.recordOrigin !== 'user') {
          record.recordOrigin = record.isTestData ? 'test' : 'user';
        }
      });
  }

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = 2;
      record.updatedAt = nowIso();
    });
}

export async function upgradeV2ToV3(tx: DexieTransaction): Promise<void> {
  const timestamp = nowIso();

  await tx
    .table('preferences')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (
        record.themePreference !== 'light' &&
        record.themePreference !== 'dark' &&
        record.themePreference !== 'system'
      ) {
        record.themePreference = APP_CONFIG.defaultTheme;
      }
      if (!record.numberFormat) record.numberFormat = APP_CONFIG.defaultNumberFormat;
      if (!record.dateFormat) record.dateFormat = APP_CONFIG.defaultDateFormat;
      if (!record.firstDayOfWeek) record.firstDayOfWeek = APP_CONFIG.defaultFirstDayOfWeek;
      if (!record.language) record.language = APP_CONFIG.defaultLanguage;
      if (!record.timezone) record.timezone = APP_CONFIG.defaultTimezone;
      if (typeof record.profileName !== 'string') record.profileName = '';
      if (typeof record.profileEmail !== 'string') record.profileEmail = '';
      if (typeof record.profileAvatar !== 'string') record.profileAvatar = '';
      record.updatedAt = timestamp;
    });

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = 3;
      record.updatedAt = timestamp;
    });
}

/**
 * Backward-compatible Dexie v3 -> v4 upgrade hook.
 * Ensures default income categories are available alongside existing expense categories.
 */
export async function upgradeV3ToV4(tx: DexieTransaction): Promise<void> {
  const timestamp = nowIso();
  const existingIncomeCount = await tx
    .table('categories')
    .where('[kind+recordOrigin]')
    .equals(['income', 'user'])
    .count();

  if (existingIncomeCount === 0) {
    await tx.table('categories').bulkPut(
      DEFAULT_INCOME_CATEGORIES.map((cat) => ({
        id: cat.id,
        name: cat.name,
        kind: cat.kind,
        sortOrder: cat.sortOrder,
        isDefault: true,
        isArchived: false,
        isTestData: false,
        recordOrigin: 'user' as const,
        createdAt: timestamp,
        updatedAt: timestamp,
      }))
    );
  }

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = 4;
      record.updatedAt = timestamp;
    });
}

/**
 * Backward-compatible Dexie v4 -> v5 upgrade hook.
 * Provisions default asset classes, default Investment Pool account, and platform cash accounts
 * while preserving all existing user data.
 */
export async function upgradeV4ToV5(tx: DexieTransaction): Promise<void> {
  const timestamp = nowIso();

  // 1. Seed default asset classes if none exist for user
  const existingAssetClassCount = await tx
    .table('assetClasses')
    .where('recordOrigin')
    .equals('user')
    .count();

  if (existingAssetClassCount === 0) {
    await tx.table('assetClasses').bulkPut(
      DEFAULT_ASSET_CLASSES.map((ac) => ({
        id: ac.id,
        code: ac.code,
        name: ac.name,
        description: ac.description,
        sortOrder: ac.sortOrder,
        isDefault: true,
        isArchived: false,
        isTestData: false,
        recordOrigin: 'user' as const,
        createdAt: timestamp,
        updatedAt: timestamp,
      }))
    );
  }

  // 2. Ensure at least one default Investment Pool account exists
  const userAccounts = (await tx
    .table('accounts')
    .where('recordOrigin')
    .equals('user')
    .toArray()) as Array<Record<string, unknown>>;

  const hasInvestmentPool = userAccounts.some(
    (acc) => acc.type === 'investment_pool' || acc.isInvestmentPool === true
  );

  if (!hasInvestmentPool) {
    await tx.table('accounts').put({
      id: APP_CONFIG.defaultInvestmentPoolAccountId,
      name: 'Investment Pool',
      type: 'investment_pool',
      currency: APP_CONFIG.defaultCurrency,
      initialBalance: 0,
      isInvestmentPool: true,
      isArchived: false,
      notes: 'Unallocated investment capital reserve.',
      isTestData: false,
      recordOrigin: 'user',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  // 3. Ensure every existing user investment platform has a linked investment_cash account
  const accountsById = new Set(userAccounts.map((a) => String(a.id)));
  const platforms = (await tx
    .table('investmentPlatforms')
    .where('recordOrigin')
    .equals('user')
    .toArray()) as Array<Record<string, unknown>>;

  for (const plat of platforms) {
    const existingCashId = typeof plat.cashAccountId === 'string' ? plat.cashAccountId : '';
    if (existingCashId && accountsById.has(existingCashId)) {
      continue;
    }

    const matchingAccount = userAccounts.find(
      (a) => a.type === 'investment_cash' && a.platformId === plat.id
    );

    if (matchingAccount) {
      await tx.table('investmentPlatforms').update(String(plat.id), {
        cashAccountId: String(matchingAccount.id),
        updatedAt: timestamp,
      });
    } else {
      const cashAccountId = `acc_cash_${String(plat.id)}`;
      await tx.table('accounts').put({
        id: cashAccountId,
        name: `${String(plat.name)} Cash`,
        type: 'investment_cash',
        currency: String(plat.defaultCurrency || APP_CONFIG.defaultCurrency).toUpperCase(),
        initialBalance: 0,
        platformId: String(plat.id),
        isInvestmentPool: false,
        isArchived: Boolean(plat.isArchived),
        notes: `Platform cash account for ${String(plat.name)}.`,
        isTestData: false,
        recordOrigin: 'user',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await tx.table('investmentPlatforms').update(String(plat.id), {
        cashAccountId,
        updatedAt: timestamp,
      });
    }
  }

  // 4. Normalize holding cost basis fields without changing existing values
  await tx
    .table('holdings')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      const qty = Number(record.quantity) || 0;
      const avg = Number(record.averageCostPerUnit) || 0;
      if (typeof record.remainingCostBasis !== 'number') {
        record.remainingCostBasis = qty * avg;
      }
      if (typeof record.realizedPnlTotal !== 'number') {
        record.realizedPnlTotal = 0;
      }
    });

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = 5;
      record.updatedAt = timestamp;
    });
}

/**
 * Backward-compatible Dexie v5 -> v6 upgrade hook.
 * Normalizes existing budgets with periodKey/date bounds/categoryNameSnapshot/isActive
 * and initializes default local budget alert thresholds.
 */
export async function upgradeV5ToV6(tx: DexieTransaction): Promise<void> {
  const timestamp = nowIso();

  const categories = (await tx.table('categories').toArray()) as Array<Record<string, unknown>>;
  const categoryNameMap = new Map(categories.map((c) => [String(c.id), String(c.name ?? '')]));

  await tx
    .table('budgets')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      const year = Number(record.year) || new Date().getUTCFullYear();
      const month = Number(record.month) || 1;
      const monthStr = String(month).padStart(2, '0');
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

      if (!record.period) record.period = 'monthly';
      if (!record.periodKey) record.periodKey = `${year}-${monthStr}`;
      if (!record.startDate) record.startDate = `${year}-${monthStr}-01`;
      if (!record.endDate) record.endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
      if (typeof record.isActive !== 'boolean') record.isActive = true;
      if (typeof record.rolloverEnabled !== 'boolean') record.rolloverEnabled = false;
      if (typeof record.rolloverAmount !== 'number') record.rolloverAmount = 0;
      if (!record.categoryNameSnapshot) {
        record.categoryNameSnapshot =
          categoryNameMap.get(String(record.categoryId)) ?? 'Archived Category';
      }
      if (!record.updatedAt) record.updatedAt = timestamp;
    });

  await tx
    .table('preferences')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (!record.budgetAlertPreferences) {
        record.budgetAlertPreferences = {
          nearLimitThresholdPct: 80,
          overBudgetThresholdPct: 100,
          enableNearLimitAlerts: true,
          enableFullLimitAlerts: true,
          enableOverBudgetAlerts: true,
        };
      }
      record.updatedAt = timestamp;
    });

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = 6;
      record.updatedAt = timestamp;
    });
}

/**
 * Backward-compatible Dexie v6 -> v7 upgrade hook.
 * Normalizes profileDescription, dated FX entry metadata, and default category icons
 * without modifying existing balances, transactions, holdings, or FX rates.
 */
export async function upgradeV6ToV7(tx: DexieTransaction): Promise<void> {
  const timestamp = nowIso();

  await tx
    .table('preferences')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (typeof record.profileDescription !== 'string') {
        record.profileDescription = '';
      }
      if (Array.isArray(record.manualFxRates)) {
        record.manualFxRates = record.manualFxRates.map((item: Record<string, unknown>) => ({
          ...item,
          id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
          createdAt:
            typeof item.createdAt === 'string' && item.createdAt
              ? item.createdAt
              : typeof item.updatedAt === 'string' && item.updatedAt
                ? item.updatedAt
                : timestamp,
          updatedAt:
            typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : timestamp,
        }));
      }
      record.updatedAt = timestamp;
    });

  await tx
    .table('categories')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (!record.icon && typeof record.id === 'string') {
        record.icon = DEFAULT_CATEGORY_ICON_MAP[record.id] ?? 'tag';
      }
    });

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = APP_CONFIG.currentSchemaVersion;
      record.updatedAt = timestamp;
    });
}

/**
 * v7 -> v8 separates manually recorded market prices from trade execution prices.
 * Historical valuation activities remain the source of truth for whether a holding
 * has a recorded price; trade prices never become market prices implicitly.
 */
export async function upgradeV7ToV8(tx: DexieTransaction): Promise<void> {
  const timestamp = nowIso();
  const activities = (await tx.table('investmentActivities').toArray()) as Array<{
    id?: string;
    platformId?: string;
    holdingId?: string;
    activityType?: string;
    unitPrice?: number;
    quantity?: number;
    grossAmount?: number;
    currency?: string;
    activityDate?: string;
    notes?: string;
    isTestData?: boolean;
    createdAt?: string;
    updatedAt?: string;
    recordOrigin?: string;
  }>;
  const priceByHolding = new Map<string, (typeof activities)[number]>();

  for (const activity of activities) {
    if (
      !activity.holdingId ||
      (activity.activityType !== 'valuation_update' &&
        activity.activityType !== 'valuation_adjustment') ||
      typeof activity.unitPrice !== 'number' ||
      !Number.isFinite(activity.unitPrice)
    ) {
      continue;
    }
    const previous = priceByHolding.get(activity.holdingId);
    if (
      !previous ||
      `${activity.activityDate ?? ''}:${activity.createdAt ?? ''}` >
        `${previous.activityDate ?? ''}:${previous.createdAt ?? ''}`
    ) {
      priceByHolding.set(activity.holdingId, activity);
    }
  }

  // Older releases could save the valuation activity without its optional snapshot.
  // Backfill those events so every existing recorded price remains visible as history.
  const valuations = tx.table('portfolioValuations');
  const existingSnapshots = (await valuations.toArray()) as Array<{
    holdingId?: string;
    valuationDate?: string;
    unitPrice?: number;
    createdAt?: string;
  }>;
  for (const snapshot of existingSnapshots) {
    if (
      !snapshot.holdingId ||
      typeof snapshot.unitPrice !== 'number' ||
      !Number.isFinite(snapshot.unitPrice)
    ) {
      continue;
    }
    const previous = priceByHolding.get(snapshot.holdingId);
    if (
      !previous ||
      `${snapshot.valuationDate ?? ''}:${snapshot.createdAt ?? ''}` >
        `${previous.activityDate ?? ''}:${previous.createdAt ?? ''}`
    ) {
      priceByHolding.set(snapshot.holdingId, {
        activityDate: snapshot.valuationDate,
        createdAt: snapshot.createdAt,
        unitPrice: snapshot.unitPrice,
      });
    }
  }
  for (const activity of activities) {
    if (
      !activity.id ||
      !activity.holdingId ||
      !activity.platformId ||
      (activity.activityType !== 'valuation_update' &&
        activity.activityType !== 'valuation_adjustment') ||
      typeof activity.unitPrice !== 'number' ||
      !Number.isFinite(activity.unitPrice)
    ) {
      continue;
    }
    const alreadySnapshotted = existingSnapshots.some(
      (snapshot) =>
        snapshot.holdingId === activity.holdingId &&
        snapshot.valuationDate === activity.activityDate &&
        snapshot.unitPrice === activity.unitPrice &&
        snapshot.createdAt === activity.createdAt
    );
    if (alreadySnapshotted) continue;

    const quantity = typeof activity.quantity === 'number' ? activity.quantity : 0;
    const marketValue =
      typeof activity.grossAmount === 'number'
        ? activity.grossAmount
        : quantity * activity.unitPrice;
    await valuations.add({
      id: `price-history-${activity.id}`,
      scope: 'holding',
      platformId: activity.platformId,
      holdingId: activity.holdingId,
      valuationDate: activity.activityDate ?? timestamp.slice(0, 10),
      unitPrice: activity.unitPrice,
      marketValue,
      currency: activity.currency ?? 'IDR',
      notes: activity.notes,
      source: 'manual',
      isTestData: activity.isTestData ?? false,
      recordOrigin: activity.recordOrigin ?? 'user',
      createdAt: activity.createdAt ?? timestamp,
      updatedAt: activity.updatedAt ?? activity.createdAt ?? timestamp,
    });
    existingSnapshots.push({
      holdingId: activity.holdingId,
      valuationDate: activity.activityDate,
      unitPrice: activity.unitPrice,
      createdAt: activity.createdAt,
    });
  }

  await tx.table('holdings').toCollection().modify((record: Record<string, unknown>) => {
    const id = typeof record.id === 'string' ? record.id : '';
    const priceActivity = priceByHolding.get(id);
    if (priceActivity) {
      record.priceRecorded = true;
      record.currentPrice = priceActivity.unitPrice;
      record.lastValuationDate = priceActivity.activityDate;
      const quantity = typeof record.quantity === 'number' ? record.quantity : 0;
      record.currentMarketValue = quantity * (priceActivity.unitPrice ?? 0);
    } else {
      record.priceRecorded = false;
      delete record.currentPrice;
      record.currentMarketValue = 0;
      delete record.lastValuationDate;
    }
    record.updatedAt = timestamp;
  });

  await tx
    .table('appInstallation')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      record.schemaVersion = APP_CONFIG.currentSchemaVersion;
      record.updatedAt = timestamp;
    });
}

