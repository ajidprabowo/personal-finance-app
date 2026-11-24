import { roundCurrencyAmount } from '@/lib/currency';
import { isValidDateString } from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import type { Account, Category, Subcategory, Transaction, TransactionType } from '@/types/entities';

export interface TransactionWriteInput {
  type: TransactionType;
  amount: number;
  date: string;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  description?: string;
  notes?: string;
  transferGroupId?: string;
  emailImportId?: string;
}

export interface TransactionValidationContext {
  accountsById: Map<string, Account>;
  categoriesById: Map<string, Category>;
  subcategoriesById?: Map<string, Subcategory>;
  existingTransferGroups?: Map<string, Transaction[]>;
  editingTransactionId?: string;
  allowArchivedAccountIds?: Set<string>;
}

export interface ValidatedTransactionInput {
  type: TransactionType;
  amount: number;
  currency: string;
  date: string;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  description: string;
  notes?: string;
  transferGroupId?: string;
  emailImportId?: string;
}

export function validateTransactionInput(
  raw: TransactionWriteInput,
  ctx: TransactionValidationContext
): ValidatedTransactionInput {
  const errors: string[] = [];

  if (raw.type !== 'income' && raw.type !== 'expense' && raw.type !== 'transfer') {
    errors.push('Transaction type must be income, expense, or transfer.');
  }

  if (!isValidDateString(raw.date)) {
    errors.push('Transaction date must be a valid YYYY-MM-DD calendar date.');
  }

  const sourceAccount = raw.accountId ? ctx.accountsById.get(raw.accountId) : undefined;
  if (!raw.accountId || !sourceAccount) {
    errors.push('A valid source account is required.');
  } else if (
    sourceAccount.isArchived &&
    !ctx.allowArchivedAccountIds?.has(sourceAccount.id)
  ) {
    errors.push(`Account "${sourceAccount.name}" is inactive/archived and cannot accept new transactions.`);
  }

  const currency = sourceAccount?.currency ?? 'IDR';
  const rawAmount = Number(raw.amount);
  const roundedAmount = roundCurrencyAmount(rawAmount, currency);
  if (!Number.isFinite(rawAmount) || roundedAmount <= 0) {
    errors.push('Amount must be greater than zero.');
  }

  let destinationAccount: Account | undefined;
  let validatedCategoryId: string | undefined;
  let description = (raw.description ?? '').trim();
  let transferGroupId: string | undefined;

  if (raw.type === 'transfer') {
    if (!raw.toAccountId) {
      errors.push('Destination account is required for transfers.');
    } else {
      destinationAccount = ctx.accountsById.get(raw.toAccountId);
      if (!destinationAccount) {
        errors.push('Selected destination account does not exist.');
      } else {
        if (
          destinationAccount.isArchived &&
          !ctx.allowArchivedAccountIds?.has(destinationAccount.id)
        ) {
          errors.push(
            `Destination account "${destinationAccount.name}" is inactive/archived and cannot receive new transfers.`
          );
        }
        if (sourceAccount && destinationAccount.id === sourceAccount.id) {
          errors.push('Source and destination accounts must be different.');
        }
        if (sourceAccount && destinationAccount.currency !== sourceAccount.currency) {
          errors.push(
            `Multi-currency transfers are not supported yet (${sourceAccount.currency} to ${destinationAccount.currency}). Both accounts must share the same currency.`
          );
        }
      }
    }

    if (!description && sourceAccount && destinationAccount) {
      description = `Transfer: ${sourceAccount.name} -> ${destinationAccount.name}`;
    } else if (!description) {
      description = 'Internal Transfer';
    }

    transferGroupId = raw.transferGroupId?.trim() || crypto.randomUUID();
    if (ctx.existingTransferGroups) {
      const existingGroupRows = ctx.existingTransferGroups.get(transferGroupId) ?? [];
      const conflicting = existingGroupRows.filter((r) => r.id !== ctx.editingTransactionId);
      if (conflicting.length > 0) {
        errors.push(`Duplicate transfer group "${transferGroupId}" detected.`);
      }
    }
  } else {
    const category = raw.categoryId ? ctx.categoriesById.get(raw.categoryId) : undefined;
    if (!raw.categoryId || !category) {
      errors.push('A valid category is required for income and expense transactions.');
    } else if (category.isArchived && !ctx.editingTransactionId) {
      errors.push(`Category "${category.name}" is archived and cannot be used for new transactions.`);
    } else {
      validatedCategoryId = category.id;
      let validSubcategory: Subcategory | undefined;
      if (raw.subcategoryId && ctx.subcategoriesById) {
        const sub = ctx.subcategoriesById.get(raw.subcategoryId);
        if (!sub || sub.categoryId !== category.id) {
          errors.push('Selected subcategory does not belong to the chosen category.');
        } else if (sub.isArchived && !ctx.editingTransactionId) {
          errors.push(`Subcategory "${sub.name}" is archived and cannot be used for new transactions.`);
        } else {
          validSubcategory = sub;
        }
      }
      if (!description) {
        if (validSubcategory) description = validSubcategory.name;
        else errors.push('Description is required unless a subcategory is selected.');
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  const trimmedNotes = raw.notes?.trim();
  const trimmedEmailImportId = raw.emailImportId?.trim();

  return {
    type: raw.type,
    amount: roundedAmount,
    currency,
    date: raw.date,
    accountId: sourceAccount!.id,
    toAccountId: destinationAccount?.id,
    categoryId: validatedCategoryId,
    subcategoryId: raw.type === 'transfer' ? undefined : raw.subcategoryId || undefined,
    description,
    notes: trimmedNotes ? trimmedNotes : undefined,
    transferGroupId,
    emailImportId: trimmedEmailImportId ? trimmedEmailImportId : undefined,
  };
}
