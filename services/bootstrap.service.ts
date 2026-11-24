import { ensureDatabaseOpen, verifyDatabaseConnection } from '@/database/client';
import {
  DEFAULT_ASSET_CLASSES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_INVESTMENT_PLATFORMS,
  DEFAULT_USER_CATEGORIES,
} from '@/database/schema';
import { DEFAULT_CATEGORY_ICON_MAP } from '@/lib/category-icons';
import { APP_CONFIG } from '@/lib/config';
import { nowIso } from '@/lib/dates';
import { appInstallationRepository, preferencesRepository } from '@/repositories';
import type { AppInstallation, UserPreferences } from '@/types/entities';

export interface BootstrapResult {
  installation: AppInstallation;
  preferences: UserPreferences;
  schemaVersion: number;
  isFirstLaunch: boolean;
}

let inflightBootstrap: Promise<BootstrapResult> | null = null;

async function runBootstrapSequence(): Promise<BootstrapResult> {
  const db = await ensureDatabaseOpen();
  const connection = await verifyDatabaseConnection();
  const timestamp = nowIso();

  let isFirstLaunch = false;
  let installation: AppInstallation | undefined;
  let preferences: UserPreferences | undefined;

  await db.transaction(
    'rw',
    [
      db.appInstallation,
      db.preferences,
      db.accounts,
      db.categories,
      db.investmentPlatforms,
      db.assetClasses,
    ],
    async () => {
      const existingInstallations = await db.appInstallation.limit(1).toArray();
      const existing = existingInstallations[0];

      if (existing) {
        installation = {
          ...existing,
          schemaVersion: connection.schemaVersion,
          appLabel: APP_CONFIG.appName,
          lastOpenedAt: timestamp,
          updatedAt: timestamp,
        };
        await db.appInstallation.put(installation);
      } else {
        isFirstLaunch = true;
        const newInstallationId = crypto.randomUUID();
        installation = {
          id: 'installation_singleton',
          installationId: newInstallationId,
          schemaVersion: connection.schemaVersion,
          appLabel: APP_CONFIG.appName,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastOpenedAt: timestamp,
        };
        await db.appInstallation.add(installation);
      }

      const existingPrefs = await db.preferences
        .where('installationId')
        .equals(installation.installationId)
        .first();

      if (existingPrefs) {
        preferences = {
          ...existingPrefs,
          themePreference:
            existingPrefs.themePreference === 'neutral'
              ? APP_CONFIG.defaultTheme
              : existingPrefs.themePreference ?? APP_CONFIG.defaultTheme,
          numberFormat: existingPrefs.numberFormat ?? APP_CONFIG.defaultNumberFormat,
          dateFormat: existingPrefs.dateFormat ?? APP_CONFIG.defaultDateFormat,
          firstDayOfWeek: existingPrefs.firstDayOfWeek ?? APP_CONFIG.defaultFirstDayOfWeek,
          language: existingPrefs.language ?? APP_CONFIG.defaultLanguage,
          timezone: existingPrefs.timezone ?? APP_CONFIG.defaultTimezone,
          profileName: existingPrefs.profileName ?? '',
          profileEmail: existingPrefs.profileEmail ?? '',
          profileAvatar: existingPrefs.profileAvatar ?? '',
          profileDescription: existingPrefs.profileDescription ?? '',
          lastBackupAt: existingPrefs.lastBackupAt,
          budgetAlertPreferences: existingPrefs.budgetAlertPreferences ?? {
            nearLimitThresholdPct: 80,
            overBudgetThresholdPct: 100,
            enableNearLimitAlerts: true,
            enableFullLimitAlerts: true,
            enableOverBudgetAlerts: true,
          },
        };
      } else {
        preferences = {
          id: 'preferences_default',
          installationId: installation.installationId,
          baseCurrency: APP_CONFIG.defaultCurrency,
          locale: APP_CONFIG.defaultLocale,
          numberFormat: APP_CONFIG.defaultNumberFormat,
          dateFormat: APP_CONFIG.defaultDateFormat,
          firstDayOfWeek: APP_CONFIG.defaultFirstDayOfWeek,
          language: APP_CONFIG.defaultLanguage,
          timezone: APP_CONFIG.defaultTimezone,
          fiscalMonthStart: APP_CONFIG.defaultFiscalMonthStart,
          themePreference: APP_CONFIG.defaultTheme,
          profileName: '',
          profileEmail: '',
          profileAvatar: '',
          profileDescription: '',
          budgetAlertPreferences: {
            nearLimitThresholdPct: 80,
            overBudgetThresholdPct: 100,
            enableNearLimitAlerts: true,
            enableFullLimitAlerts: true,
            enableOverBudgetAlerts: true,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await db.preferences.add(preferences);
      }

      // Seed default expense categories once when no user expense categories exist
      const userExpenseCategoryCount = await db.categories
        .where('[kind+recordOrigin]')
        .equals(['expense', 'user'])
        .count();
      if (userExpenseCategoryCount === 0) {
        await db.categories.bulkPut(
          DEFAULT_USER_CATEGORIES.map((cat) => ({
            id: cat.id,
            name: cat.name,
            kind: cat.kind,
            icon: DEFAULT_CATEGORY_ICON_MAP[cat.id] ?? 'tag',
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

      // Seed default income categories once when no user income categories exist
      const userIncomeCategoryCount = await db.categories
        .where('[kind+recordOrigin]')
        .equals(['income', 'user'])
        .count();
      if (userIncomeCategoryCount === 0) {
        await db.categories.bulkPut(
          DEFAULT_INCOME_CATEGORIES.map((cat) => ({
            id: cat.id,
            name: cat.name,
            kind: cat.kind,
            icon: DEFAULT_CATEGORY_ICON_MAP[cat.id] ?? 'tag',
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

      // Seed default investment platforms once when no user platforms exist
      const userPlatformCount = await db.investmentPlatforms
        .where('recordOrigin')
        .equals('user')
        .count();
      if (userPlatformCount === 0) {
        await db.investmentPlatforms.bulkPut(
          DEFAULT_INVESTMENT_PLATFORMS.map((plat) => ({
            id: plat.id,
            name: plat.name,
            kind: plat.kind,
            defaultCurrency: plat.defaultCurrency,
            cashAccountId: `acc_cash_${plat.id}`,
            supportsInvestmentPool: plat.supportsInvestmentPool,
            isDefault: true,
            isArchived: false,
            isTestData: false,
            recordOrigin: 'user' as const,
            createdAt: timestamp,
            updatedAt: timestamp,
          }))
        );
      }

      // Seed default asset classes once when no user asset classes exist
      const userAssetClassCount = await db.assetClasses
        .where('recordOrigin')
        .equals('user')
        .count();
      if (userAssetClassCount === 0) {
        await db.assetClasses.bulkPut(
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

      // Ensure default Investment Pool account and linked platform cash accounts exist
      const existingUserAccounts = await db.accounts
        .where('recordOrigin')
        .equals('user')
        .toArray();
      const hasPool = existingUserAccounts.some(
        (acc) => acc.type === 'investment_pool' || acc.isInvestmentPool === true
      );
      if (!hasPool) {
        await db.accounts.put({
          id: APP_CONFIG.defaultInvestmentPoolAccountId,
          name: 'Investment Pool',
          type: 'investment_pool',
          currency: preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency,
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

      const accountIdsSet = new Set(existingUserAccounts.map((a) => a.id));
      const platforms = await db.investmentPlatforms
        .where('recordOrigin')
        .equals('user')
        .toArray();
      for (const plat of platforms) {
        if (plat.cashAccountId && accountIdsSet.has(plat.cashAccountId)) {
          continue;
        }
        const linkedCash = existingUserAccounts.find(
          (a) => a.type === 'investment_cash' && a.platformId === plat.id
        );
        if (linkedCash) {
          await db.investmentPlatforms.update(plat.id, {
            cashAccountId: linkedCash.id,
            updatedAt: timestamp,
          });
        } else {
          const cashAccountId = plat.cashAccountId || `acc_cash_${plat.id}`;
          await db.accounts.put({
            id: cashAccountId,
            name: `${plat.name} Cash`,
            type: 'investment_cash',
            currency: plat.defaultCurrency,
            initialBalance: 0,
            platformId: plat.id,
            isInvestmentPool: false,
            isArchived: plat.isArchived,
            notes: `Platform cash account for ${plat.name}.`,
            isTestData: false,
            recordOrigin: 'user',
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          await db.investmentPlatforms.update(plat.id, {
            cashAccountId,
            updatedAt: timestamp,
          });
        }
      }
    }
  );

  if (!installation || !preferences) {
    installation = await appInstallationRepository.getSingleton();
    preferences = installation
      ? await preferencesRepository.getByInstallationId(installation.installationId)
      : undefined;
  }

  if (!installation || !preferences) {
    throw new Error('Database bootstrap completed without valid installation or preference records.');
  }

  return {
    installation,
    preferences,
    schemaVersion: connection.schemaVersion,
    isFirstLaunch,
  };
}

export async function initializeApplication(): Promise<BootstrapResult> {
  if (!inflightBootstrap) {
    inflightBootstrap = runBootstrapSequence().finally(() => {
      inflightBootstrap = null;
    });
  }
  return inflightBootstrap;
}
