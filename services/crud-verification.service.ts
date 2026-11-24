import { ensureDatabaseOpen } from '@/database/client';
import { APP_CONFIG } from '@/lib/config';
import { roundCurrencyAmount } from '@/lib/currency';
import { todayDateString } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import {
  accountsRepository,
  categoriesRepository,
  TEST_AWARE_REPOSITORIES,
  transactionsRepository,
} from '@/repositories';
import type {
  Account,
  AccountType,
  Category,
  CategoryKind,
  Transaction,
  TransactionType,
} from '@/types/entities';

export interface CreateTestAccountInput {
  name: string;
  type: AccountType;
  initialBalance: number;
  currency?: string;
}

export interface CreateTestCategoryInput {
  name: string;
  kind: CategoryKind;
}

export interface CreateTestTransactionInput {
  accountId: string;
  categoryId?: string;
  type: TransactionType;
  amount: number;
  description: string;
  date?: string;
}

export interface ClearTestDataSummary {
  totalDeleted: number;
  deletedByTable: Record<string, number>;
}

export async function listVerificationTestData(): Promise<{
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}> {
  const [accounts, categories, transactions] = await Promise.all([
    accountsRepository.getTestRecords(),
    categoriesRepository.getTestRecords(),
    transactionsRepository.getTestRecords(),
  ]);

  return {
    accounts: accounts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    categories: categories.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    transactions: transactions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function createTestAccount(input: CreateTestAccountInput): Promise<Account> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Test account name is required.');
  }
  const currency = (input.currency ?? APP_CONFIG.defaultCurrency).toUpperCase();
  const initialBalance = roundCurrencyAmount(Number(input.initialBalance) || 0, currency);

  return accountsRepository.createTestRecord({
    name,
    type: input.type,
    currency,
    initialBalance,
    isArchived: false,
    notes: 'Stage 1 CRUD verification test record',
  });
}

export async function updateTestAccount(
  id: string,
  patch: { name?: string; initialBalance?: number }
): Promise<Account> {
  const existing = await accountsRepository.getById(id);
  if (!existing || !existing.isTestData || existing.recordOrigin !== 'test') {
    throw new ValidationError('Only verification test accounts can be modified here.');
  }

  return accountsRepository.update(id, {
    ...(patch.name !== undefined ? { name: patch.name.trim() || existing.name } : {}),
    ...(patch.initialBalance !== undefined
      ? { initialBalance: roundCurrencyAmount(patch.initialBalance, existing.currency) }
      : {}),
  });
}

export async function deleteTestAccount(id: string): Promise<void> {
  await accountsRepository.deleteTestRecordById(id);
}

export async function createTestCategory(input: CreateTestCategoryInput): Promise<Category> {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Test category name is required.');
  }
  const existing = await categoriesRepository.getTestRecords();
  return categoriesRepository.createTestRecord({
    name,
    kind: input.kind,
    sortOrder: existing.length + 1,
    isArchived: false,
  });
}

export async function updateTestCategory(id: string, name: string): Promise<Category> {
  const existing = await categoriesRepository.getById(id);
  if (!existing || !existing.isTestData || existing.recordOrigin !== 'test') {
    throw new ValidationError('Only verification test categories can be modified here.');
  }
  return categoriesRepository.update(id, { name: name.trim() || existing.name });
}

export async function deleteTestCategory(id: string): Promise<void> {
  await categoriesRepository.deleteTestRecordById(id);
}

export async function createTestTransaction(input: CreateTestTransactionInput): Promise<Transaction> {
  const description = input.description.trim();
  if (!description) {
    throw new ValidationError('Test transaction description is required.');
  }
  if (!input.accountId) {
    throw new ValidationError('Select a test account before creating a test transaction.');
  }
  const amount = roundCurrencyAmount(Math.abs(Number(input.amount) || 0), APP_CONFIG.defaultCurrency);
  if (amount <= 0) {
    throw new ValidationError('Test transaction amount must be greater than 0 IDR.');
  }

  return transactionsRepository.createTestRecord({
    accountId: input.accountId,
    categoryId: input.categoryId || undefined,
    type: input.type,
    amount,
    currency: APP_CONFIG.defaultCurrency,
    date: input.date || todayDateString(),
    description,
    status: 'posted',
    notes: 'Stage 1 CRUD verification test record',
  });
}

export async function updateTestTransaction(
  id: string,
  patch: { description?: string; amount?: number }
): Promise<Transaction> {
  const existing = await transactionsRepository.getById(id);
  if (!existing || !existing.isTestData || existing.recordOrigin !== 'test') {
    throw new ValidationError('Only verification test transactions can be modified here.');
  }

  return transactionsRepository.update(id, {
    ...(patch.description !== undefined
      ? { description: patch.description.trim() || existing.description }
      : {}),
    ...(patch.amount !== undefined
      ? { amount: roundCurrencyAmount(Math.abs(patch.amount), existing.currency) }
      : {}),
  });
}

export async function deleteTestTransaction(id: string): Promise<void> {
  await transactionsRepository.deleteTestRecordById(id);
}

/**
 * Strictly removes ONLY records created by the verification workbench (recordOrigin === 'test' && isTestData === true).
 * Real user financial records are never touched.
 */
export async function clearAllVerificationTestData(): Promise<ClearTestDataSummary> {
  const db = await ensureDatabaseOpen();
  const deletedByTable: Record<string, number> = {};
  let totalDeleted = 0;

  await db.transaction('rw', db.tables, async () => {
    for (const repo of TEST_AWARE_REPOSITORIES) {
      const deletedCount = await repo.deleteTestRecordsOnly();
      if (deletedCount > 0) {
        deletedByTable[repo.tableName] = deletedCount;
        totalDeleted += deletedCount;
      }
    }
  });

  return {
    totalDeleted,
    deletedByTable,
  };
}
