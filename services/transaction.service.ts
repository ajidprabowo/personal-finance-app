import { ensureDatabaseOpen } from '@/database/client';
import { nowIso } from '@/lib/dates';
import { DatabaseError, SafetyGuardError, ValidationError } from '@/lib/errors';
import {
  accountsRepository,
  categoriesRepository,
  subcategoriesRepository,
  transactionsRepository,
} from '@/repositories';
import {
  validateTransactionInput,
  type TransactionWriteInput,
} from '@/services/transaction-validation.service';
import { reconcileAffectedBudgetPeriods } from '@/services/budget.service';
import type {
  Account,
  Category,
  RecordOrigin,
  Subcategory,
  Transaction,
  TransactionType,
} from '@/types/entities';

export interface TransactionListFilters {
  recordOrigin?: RecordOrigin;
  search?: string;
  type?: TransactionType | 'all';
  categoryId?: string | 'all';
  accountId?: string | 'all';
  startDate?: string | null;
  endDate?: string | null;
  sortOrder?: 'newest' | 'oldest';
  page?: number;
  pageSize?: number;
}

export interface EnrichedTransactionItem {
  transaction: Transaction;
  accountName: string;
  destinationAccountName?: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryArchived?: boolean;
  subcategoryName?: string;
}

export interface PaginatedTransactionsResult {
  items: EnrichedTransactionItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TransactionDetailResult extends EnrichedTransactionItem {
  accountCurrency: string;
  destinationAccountCurrency?: string;
}

async function loadLookupMaps(origin: RecordOrigin): Promise<{
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  subcategoriesById: Map<string, Subcategory>;
}> {
  const [accounts, categories, subcategories] = await Promise.all([
    origin === 'test' ? accountsRepository.getTestRecords() : accountsRepository.getUserRecords(),
    origin === 'test' ? categoriesRepository.getTestRecords() : categoriesRepository.getUserRecords(),
    origin === 'test'
      ? subcategoriesRepository.getTestRecords()
      : subcategoriesRepository.getUserRecords(),
  ]);

  return {
    accountsById: new Map(accounts.map((a) => [a.id, a])),
    categoriesById: new Map(categories.map((c) => [c.id, c])),
    subcategoriesById: new Map(subcategories.map((s) => [s.id, s])),
  };
}

export async function createTransaction(
  input: TransactionWriteInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<Transaction> {
  const origin: RecordOrigin = options?.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  const created = await db.transaction(
    'rw',
    [db.transactions, db.accounts, db.categories, db.subcategories],
    async () => {
      const [accounts, categories, subcategories, existingGroupRows] = await Promise.all([
        db.accounts.where('recordOrigin').equals(origin).toArray(),
        db.categories.where('recordOrigin').equals(origin).toArray(),
        db.subcategories.where('recordOrigin').equals(origin).toArray(),
        input.transferGroupId
          ? db.transactions.where('transferGroupId').equals(input.transferGroupId).toArray()
          : Promise.resolve([]),
      ]);

      const accountsById = new Map(accounts.map((a) => [a.id, a]));
      const categoriesById = new Map(categories.map((c) => [c.id, c]));
      const subcategoriesById = new Map(subcategories.map((s) => [s.id, s]));
      const existingTransferGroups = new Map<string, Transaction[]>();
      if (input.transferGroupId) {
        existingTransferGroups.set(input.transferGroupId, existingGroupRows);
      }

      const validated = validateTransactionInput(input, {
        accountsById,
        categoriesById,
        subcategoriesById,
        existingTransferGroups,
      });

    const timestamp = nowIso();
    const record: Transaction = {
      id: crypto.randomUUID(),
      accountId: validated.accountId,
      toAccountId: validated.toAccountId,
      transferGroupId: validated.transferGroupId,
      categoryId: validated.categoryId,
      subcategoryId: validated.subcategoryId,
      type: validated.type,
      amount: validated.amount,
      currency: validated.currency,
      date: validated.date,
      description: validated.description,
      status: 'posted',
      emailImportId: validated.emailImportId,
      notes: validated.notes,
      isTestData: origin === 'test',
      recordOrigin: origin,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.transactions.add(record);
    return record;
  });

  if (created.type === 'expense') {
    await syncBudgetsAfterMutation([created.date], origin);
  }
  return created;
}

async function syncBudgetsAfterMutation(
  dates: string[],
  origin: RecordOrigin
): Promise<void> {
  if (dates.length === 0) return;
  await reconcileAffectedBudgetPeriods(dates, origin).catch(() => undefined);
}

export async function updateTransaction(
  id: string,
  input: TransactionWriteInput,
  options?: { recordOrigin?: RecordOrigin }
): Promise<Transaction> {
  const origin: RecordOrigin = options?.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  let previousType: TransactionType | null = null;
  let previousDate: string | null = null;

  const updated = await db.transaction(
    'rw',
    [db.transactions, db.accounts, db.categories, db.subcategories],
    async () => {
      const existing = await db.transactions.get(id);
      if (!existing) {
        throw new DatabaseError(`Transaction "${id}" was not found.`);
      }
      previousType = existing.type;
      previousDate = existing.date;
      if (existing.recordOrigin !== origin) {
        throw new SafetyGuardError('Cannot modify a transaction from a different data origin.');
      }

      const [accounts, categories, subcategories] = await Promise.all([
        db.accounts.where('recordOrigin').equals(origin).toArray(),
        db.categories.where('recordOrigin').equals(origin).toArray(),
        db.subcategories.where('recordOrigin').equals(origin).toArray(),
      ]);

      const accountsById = new Map(accounts.map((a) => [a.id, a]));
      const categoriesById = new Map(categories.map((c) => [c.id, c]));
      const subcategoriesById = new Map(subcategories.map((s) => [s.id, s]));

      // Allow preserving an already-linked inactive account when editing existing historical entry
      const allowArchivedAccountIds = new Set<string>([existing.accountId]);
      if (existing.toAccountId) {
        allowArchivedAccountIds.add(existing.toAccountId);
      }

      const effectiveTransferGroupId =
        input.type === 'transfer'
          ? input.transferGroupId || existing.transferGroupId || crypto.randomUUID()
          : undefined;

      const existingTransferGroups = new Map<string, Transaction[]>();
      if (effectiveTransferGroupId) {
        const rows = await db.transactions
          .where('transferGroupId')
          .equals(effectiveTransferGroupId)
          .toArray();
        existingTransferGroups.set(effectiveTransferGroupId, rows);
      }

      const validated = validateTransactionInput(
        { ...input, transferGroupId: effectiveTransferGroupId },
        {
          accountsById,
          categoriesById,
          subcategoriesById,
          existingTransferGroups,
          editingTransactionId: existing.id,
          allowArchivedAccountIds,
        }
      );

    // If an older paired-record transferGroupId existed, remove any secondary sibling atomically
    // so only the single canonical linked transfer record remains.
    if (existing.transferGroupId) {
      const groupRows = await db.transactions
        .where('transferGroupId')
        .equals(existing.transferGroupId)
        .toArray();
      const extraIds = groupRows.filter((r) => r.id !== existing.id).map((r) => r.id);
      if (extraIds.length > 0) {
        await db.transactions.bulkDelete(extraIds);
      }
    }

    const nextRecord: Transaction = {
      ...existing,
      accountId: validated.accountId,
      toAccountId: validated.toAccountId,
      transferGroupId: validated.transferGroupId,
      categoryId: validated.categoryId,
      subcategoryId: validated.subcategoryId,
      type: validated.type,
      amount: validated.amount,
      currency: validated.currency,
      date: validated.date,
      description: validated.description,
      emailImportId: validated.emailImportId ?? existing.emailImportId,
      notes: validated.notes,
      updatedAt: nowIso(),
    };

    await db.transactions.put(nextRecord);
    return nextRecord;
  });

  if (previousType === 'expense' || updated.type === 'expense') {
    const affectedDates = [updated.date];
    if (previousDate) affectedDates.push(previousDate);
    await syncBudgetsAfterMutation(affectedDates, origin);
  }
  return updated;
}

export async function deleteTransaction(
  id: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<{ deletedCount: number }> {
  const origin: RecordOrigin = options?.recordOrigin ?? 'user';
  const db = await ensureDatabaseOpen();

  let deletedExpenseDate: string | null = null;
  const result = await db.transaction('rw', [db.transactions], async () => {
    const existing = await db.transactions.get(id);
    if (!existing) {
      return { deletedCount: 0 };
    }
    if (existing.recordOrigin !== origin) {
      throw new SafetyGuardError('Cannot delete a transaction from a different data origin.');
    }

    if (existing.type === 'transfer' && existing.transferGroupId) {
      const groupRows = await db.transactions
        .where('transferGroupId')
        .equals(existing.transferGroupId)
        .toArray();
      const idsToDelete = groupRows
        .filter((row) => row.recordOrigin === origin)
        .map((row) => row.id);
      if (idsToDelete.length > 0) {
        await db.transactions.bulkDelete(idsToDelete);
        return { deletedCount: idsToDelete.length };
      }
    }

    if (existing.type === 'expense') {
      deletedExpenseDate = existing.date;
    }
    await db.transactions.delete(id);
    return { deletedCount: 1 };
  });

  if (deletedExpenseDate) {
    await syncBudgetsAfterMutation([deletedExpenseDate], origin);
  }
  return result;
}

export async function listTransactionsFiltered(
  filters: TransactionListFilters
): Promise<PaginatedTransactionsResult> {
  const origin: RecordOrigin = filters.recordOrigin ?? 'user';
  const pageSize = Math.max(1, Math.min(filters.pageSize ?? 20, 100));
  const requestedPage = Math.max(1, filters.page ?? 1);

  const [rawTransactions, lookups] = await Promise.all([
    transactionsRepository.getByOriginAndDateRange(
      origin,
      filters.startDate ?? null,
      filters.endDate ?? null
    ),
    loadLookupMaps(origin),
  ]);

  const searchLower = filters.search?.trim().toLowerCase() ?? '';
  const typeFilter = filters.type ?? 'all';
  const categoryFilter = filters.categoryId ?? 'all';
  const accountFilter = filters.accountId ?? 'all';
  const sortOrder = filters.sortOrder ?? 'newest';

  const seenTransferGroups = new Set<string>();
  const filtered: Transaction[] = [];

  for (const tx of rawTransactions) {
    if (tx.type === 'transfer' && tx.transferGroupId) {
      if (seenTransferGroups.has(tx.transferGroupId)) continue;
      seenTransferGroups.add(tx.transferGroupId);
    }

    if (typeFilter !== 'all' && tx.type !== typeFilter) continue;

    if (categoryFilter !== 'all') {
      if (tx.type === 'transfer' || tx.categoryId !== categoryFilter) continue;
    }

    if (accountFilter !== 'all') {
      const matchesSource = tx.accountId === accountFilter;
      const matchesDest = tx.toAccountId === accountFilter;
      if (!matchesSource && !matchesDest) continue;
    }

    if (searchLower) {
      const descMatch = tx.description.toLowerCase().includes(searchLower);
      const notesMatch = (tx.notes ?? '').toLowerCase().includes(searchLower);
      if (!descMatch && !notesMatch) continue;
    }

    filtered.push(tx);
  }

  filtered.sort((a, b) => {
    const dateCmp =
      sortOrder === 'newest' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return sortOrder === 'newest'
      ? b.createdAt.localeCompare(a.createdAt)
      : a.createdAt.localeCompare(b.createdAt);
  });

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(requestedPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(startIndex, startIndex + pageSize);

  const items: EnrichedTransactionItem[] = pageRows.map((tx) => {
    const sourceAcc = lookups.accountsById.get(tx.accountId);
    const destAcc = tx.toAccountId ? lookups.accountsById.get(tx.toAccountId) : undefined;
    const cat = tx.categoryId ? lookups.categoriesById.get(tx.categoryId) : undefined;
    const sub = tx.subcategoryId ? lookups.subcategoriesById.get(tx.subcategoryId) : undefined;

    return {
      transaction: tx,
      accountName: sourceAcc?.name ?? 'Unknown Account',
      destinationAccountName: destAcc?.name ?? (tx.toAccountId ? 'Unknown Account' : undefined),
      categoryName:
        tx.type === 'transfer'
          ? 'Internal Transfer'
          : cat?.name ?? (tx.categoryId ? 'Removed Category' : 'Uncategorized'),
      categoryIcon: cat?.icon,
      categoryArchived: cat?.isArchived ?? false,
      subcategoryName: sub?.name,
    };
  });

  return {
    items,
    totalCount,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function getTransactionDetail(
  id: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<TransactionDetailResult> {
  const origin: RecordOrigin = options?.recordOrigin ?? 'user';
  const tx = await transactionsRepository.getById(id);
  if (!tx || tx.recordOrigin !== origin) {
    throw new ValidationError('Transaction record not found.');
  }

  const lookups = await loadLookupMaps(origin);
  const sourceAcc = lookups.accountsById.get(tx.accountId);
  const destAcc = tx.toAccountId ? lookups.accountsById.get(tx.toAccountId) : undefined;
  const cat = tx.categoryId ? lookups.categoriesById.get(tx.categoryId) : undefined;
  const sub = tx.subcategoryId ? lookups.subcategoriesById.get(tx.subcategoryId) : undefined;

  return {
    transaction: tx,
    accountName: sourceAcc?.name ?? 'Unknown Account',
    accountCurrency: sourceAcc?.currency ?? tx.currency,
    destinationAccountName: destAcc?.name ?? (tx.toAccountId ? 'Unknown Account' : undefined),
    destinationAccountCurrency: destAcc?.currency,
    categoryName:
      tx.type === 'transfer'
        ? 'Internal Transfer'
        : cat?.name ?? (tx.categoryId ? 'Removed Category' : 'Uncategorized'),
    categoryIcon: cat?.icon,
    categoryArchived: cat?.isArchived ?? false,
    subcategoryName: sub?.name,
  };
}
