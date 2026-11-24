import { ensureDatabaseOpen } from '@/database/client';
import { nowIso } from '@/lib/dates';
import type { DatabaseValidationReport, ValidationIssue } from '@/types/database';
import type {
  Account,
  AppInstallation,
  Budget,
  BudgetAlert,
  Category,
  EmailConnection,
  EmailImportHistory,
  Holding,
  InvestmentActivity,
  InvestmentPlatform,
  MonthlyBudgetPlan,
  Subcategory,
  Transaction,
  UserPreferences,
} from '@/types/entities';

export async function validateDatabaseIntegrity(): Promise<DatabaseValidationReport> {
  const db = await ensureDatabaseOpen();
  const issues: ValidationIssue[] = [];
  let totalRecordsChecked = 0;

  const [
    installations,
    preferencesList,
    accounts,
    categories,
    subcategories,
    transactions,
    budgets,
    monthlyBudgetPlans,
    budgetAlerts,
    platforms,
    assetClasses,
    holdings,
    activities,
    valuations,
    emailConnections,
    emailHistory,
  ] = await Promise.all([
    db.appInstallation.toArray(),
    db.preferences.toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
    db.subcategories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.monthlyBudgetPlans.toArray(),
    db.budgetAlerts.toArray(),
    db.investmentPlatforms.toArray(),
    db.assetClasses.toArray(),
    db.holdings.toArray(),
    db.investmentActivities.toArray(),
    db.portfolioValuations.toArray(),
    db.emailConnections.toArray(),
    db.emailImportHistory.toArray(),
  ]);

  totalRecordsChecked =
    installations.length +
    preferencesList.length +
    accounts.length +
    categories.length +
    subcategories.length +
    transactions.length +
    budgets.length +
    monthlyBudgetPlans.length +
    budgetAlerts.length +
    platforms.length +
    assetClasses.length +
    holdings.length +
    activities.length +
    valuations.length +
    emailConnections.length +
    emailHistory.length;

  // 1. Singleton installation check
  if (installations.length === 0) {
    issues.push({
      severity: 'error',
      table: 'appInstallation',
      message: 'Missing appInstallation record. Installation ID has not been initialized.',
    });
  } else if (installations.length > 1) {
    issues.push({
      severity: 'warning',
      table: 'appInstallation',
      message: `Found ${installations.length} appInstallation records; expected a single installation record.`,
    });
  }

  const installationIds = new Set(installations.map((i: AppInstallation) => i.installationId));

  // 2. Preferences check
  for (const pref of preferencesList as UserPreferences[]) {
    if (!installationIds.has(pref.installationId)) {
      issues.push({
        severity: 'warning',
        table: 'preferences',
        recordId: pref.id,
        message: `Preferences record references unknown installationId "${pref.installationId}".`,
      });
    }
    if (!pref.baseCurrency) {
      issues.push({
        severity: 'error',
        table: 'preferences',
        recordId: pref.id,
        message: 'Preferences record is missing baseCurrency.',
      });
    }
  }

  // 3. Build foreign-key lookup sets
  const accountIds = new Set((accounts as Account[]).map((a) => a.id));
  const categoryIds = new Set((categories as Category[]).map((c) => c.id));
  const subcategoryIds = new Set((subcategories as Subcategory[]).map((s) => s.id));
  const platformIds = new Set((platforms as InvestmentPlatform[]).map((p) => p.id));
  const assetClassIds = new Set(assetClasses.map((a) => a.id));
  const holdingIds = new Set((holdings as Holding[]).map((h) => h.id));
  const connectionIds = new Set((emailConnections as EmailConnection[]).map((c) => c.id));

  // 4. Subcategory -> Category check
  for (const sub of subcategories as Subcategory[]) {
    if (!categoryIds.has(sub.categoryId)) {
      issues.push({
        severity: 'error',
        table: 'subcategories',
        recordId: sub.id,
        message: `Subcategory "${sub.name}" references missing categoryId "${sub.categoryId}".`,
      });
    }
  }

  // 5. Transaction referential checks
  for (const tx of transactions as Transaction[]) {
    if (!accountIds.has(tx.accountId)) {
      issues.push({
        severity: 'error',
        table: 'transactions',
        recordId: tx.id,
        message: `Transaction "${tx.description}" references missing accountId "${tx.accountId}".`,
      });
    }
    if (tx.toAccountId && !accountIds.has(tx.toAccountId)) {
      issues.push({
        severity: 'error',
        table: 'transactions',
        recordId: tx.id,
        message: `Transfer transaction references missing toAccountId "${tx.toAccountId}".`,
      });
    }
    if (tx.categoryId && !categoryIds.has(tx.categoryId)) {
      issues.push({
        severity: 'warning',
        table: 'transactions',
        recordId: tx.id,
        message: `Transaction references missing categoryId "${tx.categoryId}".`,
      });
    }
    if (tx.subcategoryId && !subcategoryIds.has(tx.subcategoryId)) {
      issues.push({
        severity: 'warning',
        table: 'transactions',
        recordId: tx.id,
        message: `Transaction references missing subcategoryId "${tx.subcategoryId}".`,
      });
    }
  }

  // 6. Holdings referential checks
  for (const holding of holdings as Holding[]) {
    if (!platformIds.has(holding.platformId)) {
      issues.push({
        severity: 'error',
        table: 'holdings',
        recordId: holding.id,
        message: `Holding "${holding.symbol}" references missing platformId "${holding.platformId}".`,
      });
    }
    if (!assetClassIds.has(holding.assetClassId)) {
      issues.push({
        severity: 'error',
        table: 'holdings',
        recordId: holding.id,
        message: `Holding "${holding.symbol}" references missing assetClassId "${holding.assetClassId}".`,
      });
    }
  }

  // 7. Investment activity checks
  for (const act of activities as InvestmentActivity[]) {
    const requiresPlatform =
      act.activityType !== 'contribution' && act.activityType !== 'withdrawal';
    if ((requiresPlatform || Boolean(act.platformId)) && !platformIds.has(act.platformId)) {
      issues.push({
        severity: 'error',
        table: 'investmentActivities',
        recordId: act.id,
        message: `Investment activity references missing platformId "${act.platformId}".`,
      });
    }
    if (act.holdingId && !holdingIds.has(act.holdingId)) {
      issues.push({
        severity: 'error',
        table: 'investmentActivities',
        recordId: act.id,
        message: `Investment activity references missing holdingId "${act.holdingId}".`,
      });
    }
  }

  // 8. Budget referential & amount checks (deleted categories allowed as warning if historical snapshot exists)
  const budgetIds = new Set((budgets as Budget[]).map((b) => b.id));
  for (const budget of budgets as Budget[]) {
    if (!(Number.isFinite(budget.limitAmount) && budget.limitAmount > 0)) {
      issues.push({
        severity: 'error',
        table: 'budgets',
        recordId: budget.id,
        message: `Budget "${budget.id}" has invalid limitAmount (${budget.limitAmount}).`,
      });
    }
    if (!categoryIds.has(budget.categoryId)) {
      issues.push({
        severity: budget.categoryNameSnapshot ? 'warning' : 'error',
        table: 'budgets',
        recordId: budget.id,
        message: `Budget "${budget.id}" references missing categoryId "${budget.categoryId}".`,
      });
    }
  }

  for (const plan of monthlyBudgetPlans as MonthlyBudgetPlan[]) {
    if (!(Number.isFinite(plan.totalBudgetAmount) && plan.totalBudgetAmount > 0)) {
      issues.push({
        severity: 'error',
        table: 'monthlyBudgetPlans',
        recordId: plan.id,
        message: `Monthly budget plan "${plan.periodKey}" has invalid totalBudgetAmount.`,
      });
    }
  }

  for (const alert of budgetAlerts as BudgetAlert[]) {
    if (!budgetIds.has(alert.budgetId)) {
      issues.push({
        severity: 'warning',
        table: 'budgetAlerts',
        recordId: alert.id,
        message: `Budget alert references deleted budgetId "${alert.budgetId}".`,
      });
    }
  }

  // 9. Email import history checks
  for (const item of emailHistory as EmailImportHistory[]) {
    if (!connectionIds.has(item.connectionId)) {
      issues.push({
        severity: 'error',
        table: 'emailImportHistory',
        recordId: item.id,
        message: `Email import record references missing connectionId "${item.connectionId}".`,
      });
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return {
    valid: !hasErrors,
    checkedAt: nowIso(),
    totalRecordsChecked,
    issues,
  };
}
