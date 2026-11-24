import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateTransactionInput } from '@/services/transaction-validation.service';
import type { Account, Category, Subcategory } from '@/types/entities';

const account: Account = {
  id: 'account-1',
  name: 'Checking',
  type: 'checking',
  currency: 'IDR',
  initialBalance: 0,
  isArchived: false,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
  isTestData: false,
  recordOrigin: 'user',
};

const category: Category = {
  id: 'category-1',
  name: 'Food',
  kind: 'expense',
  sortOrder: 0,
  isArchived: false,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
  isTestData: false,
  recordOrigin: 'user',
};

const subcategory: Subcategory = {
  id: 'subcategory-1',
  categoryId: category.id,
  name: 'Groceries',
  sortOrder: 0,
  isArchived: false,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
  isTestData: false,
  recordOrigin: 'user',
};

const context = {
  accountsById: new Map([[account.id, account]]),
  categoriesById: new Map([[category.id, category]]),
  subcategoriesById: new Map([[subcategory.id, subcategory]]),
};

const baseInput = {
  type: 'expense' as const,
  amount: 1000,
  date: '2026-11-24',
  accountId: account.id,
  categoryId: category.id,
  description: '',
};

describe('Transaction description validation', () => {
  it('allows an empty description when a valid subcategory is selected', () => {
    const result = validateTransactionInput(
      { ...baseInput, subcategoryId: subcategory.id },
      context
    );
    assert.equal(result.subcategoryId, subcategory.id);
    assert.equal(result.description, subcategory.name);
  });

  it('rejects an empty description when no subcategory is selected', () => {
    assert.throws(
      () => validateTransactionInput(baseInput, context),
      /Description is required unless a subcategory is selected\./
    );
  });
});
