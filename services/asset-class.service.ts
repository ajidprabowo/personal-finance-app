import { SafetyGuardError, ValidationError } from '@/lib/errors';
import { assetClassesRepository, holdingsRepository } from '@/repositories';
import type { AssetClass, RecordOrigin } from '@/types/entities';

export interface AssetClassWithUsage {
  assetClass: AssetClass;
  holdingCount: number;
}

export async function listAssetClasses(options?: {
  includeArchived?: boolean;
  recordOrigin?: RecordOrigin;
}): Promise<AssetClass[]> {
  const origin = options?.recordOrigin ?? 'user';
  const rows =
    origin === 'test'
      ? await assetClassesRepository.getTestRecords()
      : await assetClassesRepository.getUserRecords();

  const filtered = options?.includeArchived === false ? rows.filter((r) => !r.isArchived) : rows;
  return filtered.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function listAssetClassesWithUsage(options?: {
  recordOrigin?: RecordOrigin;
}): Promise<AssetClassWithUsage[]> {
  const origin = options?.recordOrigin ?? 'user';
  const [classes, holdings] = await Promise.all([
    listAssetClasses({ includeArchived: true, recordOrigin: origin }),
    origin === 'test' ? holdingsRepository.getTestRecords() : holdingsRepository.getUserRecords(),
  ]);

  const counts = new Map<string, number>();
  for (const h of holdings) {
    counts.set(h.assetClassId, (counts.get(h.assetClassId) ?? 0) + 1);
  }

  return classes.map((assetClass) => ({
    assetClass,
    holdingCount: counts.get(assetClass.id) ?? 0,
  }));
}

export async function createAssetClass(
  input: {
    name: string;
    code?: string;
    description?: string;
  },
  options?: { recordOrigin?: RecordOrigin }
): Promise<AssetClass> {
  const origin = options?.recordOrigin ?? 'user';
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('Asset class name is required.');
  }

  const existing =
    origin === 'test'
      ? await assetClassesRepository.getTestRecords()
      : await assetClassesRepository.getUserRecords();

  const normalizedCode = (
    input.code?.trim() || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  ).replace(/^_+|_+$/g, '');

  if (!normalizedCode) {
    throw new ValidationError('Asset class code is required.');
  }

  const duplicate = existing.find(
    (c) => c.code.toUpperCase() === normalizedCode || c.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    throw new ValidationError(`Asset class "${name}" (${normalizedCode}) already exists.`);
  }

  return assetClassesRepository.create({
    name,
    code: normalizedCode,
    description: input.description?.trim() || undefined,
    sortOrder: existing.length + 1,
    isDefault: false,
    isArchived: false,
    isTestData: origin === 'test',
    recordOrigin: origin,
  });
}

export async function updateAssetClass(
  id: string,
  patch: {
    name: string;
    description?: string;
    isArchived?: boolean;
  },
  options?: { recordOrigin?: RecordOrigin }
): Promise<AssetClass> {
  const origin = options?.recordOrigin ?? 'user';
  const existing = await assetClassesRepository.getById(id);
  if (!existing || existing.recordOrigin !== origin) {
    throw new ValidationError('Asset class not found.');
  }

  const name = patch.name.trim();
  if (!name) {
    throw new ValidationError('Asset class name is required.');
  }

  return assetClassesRepository.update(id, {
    name,
    description: patch.description?.trim() || undefined,
    ...(patch.isArchived !== undefined ? { isArchived: patch.isArchived } : {}),
  });
}

export async function toggleAssetClassEnabled(
  id: string,
  enabled: boolean,
  options?: { recordOrigin?: RecordOrigin }
): Promise<AssetClass> {
  const origin = options?.recordOrigin ?? 'user';
  const existing = await assetClassesRepository.getById(id);
  if (!existing || existing.recordOrigin !== origin) {
    throw new ValidationError('Asset class not found.');
  }
  return assetClassesRepository.update(id, { isArchived: !enabled });
}

export async function deleteAssetClassSafely(
  id: string,
  options?: { recordOrigin?: RecordOrigin }
): Promise<void> {
  const origin = options?.recordOrigin ?? 'user';
  const existing = await assetClassesRepository.getById(id);
  if (!existing) return;
  if (existing.recordOrigin !== origin) {
    throw new SafetyGuardError('Cannot delete an asset class from a different record origin.');
  }
  if (existing.isDefault) {
    throw new SafetyGuardError(
      `Default asset class "${existing.name}" cannot be deleted. Archive or disable it instead.`
    );
  }

  const holdings =
    origin === 'test' ? await holdingsRepository.getTestRecords() : await holdingsRepository.getUserRecords();
  const linkedCount = holdings.filter((h) => h.assetClassId === id).length;
  if (linkedCount > 0) {
    throw new SafetyGuardError(
      `Asset class "${existing.name}" is used by ${linkedCount} holding(s) and cannot be deleted. Archive or disable it instead.`
    );
  }

  await assetClassesRepository.delete(id);
}
