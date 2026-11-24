import { BaseRepository, TestAwareRepository } from '@/repositories/base.repository';
import {
  accountsRepository,
  budgetAlertsRepository,
  budgetsRepository,
  categoriesRepository,
  monthlyBudgetPlansRepository,
  subcategoriesRepository,
  transactionsRepository,
} from '@/repositories/finance.repository';
import {
  assetClassesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  investmentPlatformsRepository,
  portfolioValuationsRepository,
} from '@/repositories/investment.repository';
import {
  appInstallationRepository,
  emailConnectionsRepository,
  emailImportHistoryRepository,
  preferencesRepository,
} from '@/repositories/system.repository';
import type { DatabaseTableName } from '@/types/database';

export {
  appInstallationRepository,
  preferencesRepository,
  emailConnectionsRepository,
  emailImportHistoryRepository,
  accountsRepository,
  categoriesRepository,
  subcategoriesRepository,
  transactionsRepository,
  budgetsRepository,
  monthlyBudgetPlansRepository,
  budgetAlertsRepository,
  investmentPlatformsRepository,
  assetClassesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  portfolioValuationsRepository,
};

export const REPOSITORY_REGISTRY: Record<DatabaseTableName, BaseRepository<never>> = {
  appInstallation: appInstallationRepository as unknown as BaseRepository<never>,
  preferences: preferencesRepository as unknown as BaseRepository<never>,
  accounts: accountsRepository as unknown as BaseRepository<never>,
  categories: categoriesRepository as unknown as BaseRepository<never>,
  subcategories: subcategoriesRepository as unknown as BaseRepository<never>,
  transactions: transactionsRepository as unknown as BaseRepository<never>,
  budgets: budgetsRepository as unknown as BaseRepository<never>,
  monthlyBudgetPlans: monthlyBudgetPlansRepository as unknown as BaseRepository<never>,
  budgetAlerts: budgetAlertsRepository as unknown as BaseRepository<never>,
  investmentPlatforms: investmentPlatformsRepository as unknown as BaseRepository<never>,
  assetClasses: assetClassesRepository as unknown as BaseRepository<never>,
  holdings: holdingsRepository as unknown as BaseRepository<never>,
  investmentActivities: investmentActivitiesRepository as unknown as BaseRepository<never>,
  portfolioValuations: portfolioValuationsRepository as unknown as BaseRepository<never>,
  emailConnections: emailConnectionsRepository as unknown as BaseRepository<never>,
  emailImportHistory: emailImportHistoryRepository as unknown as BaseRepository<never>,
};

export const TEST_AWARE_REPOSITORIES: TestAwareRepository<never>[] = [
  accountsRepository as unknown as TestAwareRepository<never>,
  categoriesRepository as unknown as TestAwareRepository<never>,
  subcategoriesRepository as unknown as TestAwareRepository<never>,
  transactionsRepository as unknown as TestAwareRepository<never>,
  budgetsRepository as unknown as TestAwareRepository<never>,
  monthlyBudgetPlansRepository as unknown as TestAwareRepository<never>,
  budgetAlertsRepository as unknown as TestAwareRepository<never>,
  investmentPlatformsRepository as unknown as TestAwareRepository<never>,
  assetClassesRepository as unknown as TestAwareRepository<never>,
  holdingsRepository as unknown as TestAwareRepository<never>,
  investmentActivitiesRepository as unknown as TestAwareRepository<never>,
  portfolioValuationsRepository as unknown as TestAwareRepository<never>,
];
