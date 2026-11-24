import { TestAwareRepository } from '@/repositories/base.repository';
import type {
  Account,
  Budget,
  BudgetAlert,
  Category,
  MonthlyBudgetPlan,
  RecordOrigin,
  Subcategory,
  Transaction,
} from '@/types/entities';

class AccountsRepository extends TestAwareRepository<Account> {
  constructor() {
    super('accounts');
  }

  public async getByType(type: Account['type']): Promise<Account[]> {
    const table = await this.getTable();
    return table.where('type').equals(type).toArray();
  }
}

class CategoriesRepository extends TestAwareRepository<Category> {
  constructor() {
    super('categories');
  }

  public async getByKind(kind: Category['kind']): Promise<Category[]> {
    const table = await this.getTable();
    return table.where('kind').equals(kind).sortBy('sortOrder');
  }
}

class SubcategoriesRepository extends TestAwareRepository<Subcategory> {
  constructor() {
    super('subcategories');
  }

  public async getByCategoryId(categoryId: string): Promise<Subcategory[]> {
    const table = await this.getTable();
    return table.where('categoryId').equals(categoryId).sortBy('sortOrder');
  }
}

class TransactionsRepository extends TestAwareRepository<Transaction> {
  constructor() {
    super('transactions');
  }

  public async getByAccountId(accountId: string): Promise<Transaction[]> {
    const table = await this.getTable();
    return table.where('accountId').equals(accountId).reverse().sortBy('date');
  }

  public async getRecent(limit = 25): Promise<Transaction[]> {
    const table = await this.getTable();
    return table.orderBy('date').reverse().limit(limit).toArray();
  }

  public async getByOriginAndDateRange(
    origin: RecordOrigin,
    startDate: string | null,
    endDate: string | null
  ): Promise<Transaction[]> {
    const table = await this.getTable();
    if (startDate || endDate) {
      const lower = startDate ?? '';
      const upper = endDate ?? '\uffff';
      return table
        .where('[recordOrigin+date]')
        .between([origin, lower], [origin, upper], true, true)
        .toArray();
    }
    return table.where('recordOrigin').equals(origin).toArray();
  }

  public async getByTransferGroupId(transferGroupId: string): Promise<Transaction[]> {
    const table = await this.getTable();
    return table.where('transferGroupId').equals(transferGroupId).toArray();
  }

  public async countByCategoryId(categoryId: string): Promise<number> {
    const table = await this.getTable();
    return table.where('categoryId').equals(categoryId).count();
  }

  public async countByAccountInvolvement(accountId: string): Promise<number> {
    const table = await this.getTable();
    const [asSource, asDestination] = await Promise.all([
      table.where('accountId').equals(accountId).count(),
      table.where('toAccountId').equals(accountId).count(),
    ]);
    return asSource + asDestination;
  }
}

class BudgetsRepository extends TestAwareRepository<Budget> {
  constructor() {
    super('budgets');
  }

  public async getByYearMonth(year: number, month: number): Promise<Budget[]> {
    const table = await this.getTable();
    return table.where('[year+month]').equals([year, month]).toArray();
  }

  public async getByOriginAndPeriodKey(origin: RecordOrigin, periodKey: string): Promise<Budget[]> {
    const table = await this.getTable();
    return table.where('[recordOrigin+periodKey]').equals([origin, periodKey]).toArray();
  }
}

class MonthlyBudgetPlansRepository extends TestAwareRepository<MonthlyBudgetPlan> {
  constructor() {
    super('monthlyBudgetPlans');
  }

  public async getByOriginAndPeriodKey(
    origin: RecordOrigin,
    periodKey: string
  ): Promise<MonthlyBudgetPlan[]> {
    const table = await this.getTable();
    return table.where('[recordOrigin+periodKey]').equals([origin, periodKey]).toArray();
  }
}

class BudgetAlertsRepository extends TestAwareRepository<BudgetAlert> {
  constructor() {
    super('budgetAlerts');
  }

  public async getByOriginAndPeriodKey(
    origin: RecordOrigin,
    periodKey: string
  ): Promise<BudgetAlert[]> {
    const table = await this.getTable();
    return table.where('[recordOrigin+periodKey]').equals([origin, periodKey]).toArray();
  }
}

export const accountsRepository = new AccountsRepository();
export const categoriesRepository = new CategoriesRepository();
export const subcategoriesRepository = new SubcategoriesRepository();
export const transactionsRepository = new TransactionsRepository();
export const budgetsRepository = new BudgetsRepository();
export const monthlyBudgetPlansRepository = new MonthlyBudgetPlansRepository();
export const budgetAlertsRepository = new BudgetAlertsRepository();
