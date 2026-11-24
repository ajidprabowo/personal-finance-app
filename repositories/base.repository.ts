import type { Table } from 'dexie';
import { ensureDatabaseOpen, type PersonalFinanceDB } from '@/database/client';
import { nowIso } from '@/lib/dates';
import { DatabaseError, SafetyGuardError } from '@/lib/errors';
import type { DatabaseTableName } from '@/types/database';
import type { BaseEntity, TestTaggedEntity } from '@/types/entities';

export class BaseRepository<T extends BaseEntity> {
  public readonly tableName: DatabaseTableName;

  constructor(tableName: DatabaseTableName) {
    this.tableName = tableName;
  }

  protected async getTable(): Promise<Table<T, string>> {
    const db = await ensureDatabaseOpen();
    return db.table(this.tableName) as Table<T, string>;
  }

  protected async getDb(): Promise<PersonalFinanceDB> {
    return ensureDatabaseOpen();
  }

  public async getById(id: string): Promise<T | undefined> {
    const table = await this.getTable();
    return table.get(id);
  }

  public async getAll(): Promise<T[]> {
    const table = await this.getTable();
    return table.toArray();
  }

  public async count(): Promise<number> {
    const table = await this.getTable();
    return table.count();
  }

  public async create(
    payload: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string }
  ): Promise<T> {
    const table = await this.getTable();
    const timestamp = nowIso();
    const entity = {
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
      createdAt: payload.createdAt ?? timestamp,
      updatedAt: payload.updatedAt ?? timestamp,
    } as T;

    try {
      await table.add(entity);
      return entity;
    } catch (error) {
      throw new DatabaseError(
        `Failed to create record in ${this.tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async update(id: string, patch: Partial<Omit<T, 'id' | 'createdAt'>>): Promise<T> {
    const table = await this.getTable();
    const existing = await table.get(id);
    if (!existing) {
      throw new DatabaseError(`Record "${id}" was not found in ${this.tableName}.`);
    }

    const updated: T = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };

    try {
      await table.put(updated);
      return updated;
    } catch (error) {
      throw new DatabaseError(
        `Failed to update record "${id}" in ${this.tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  public async delete(id: string): Promise<void> {
    const table = await this.getTable();
    await table.delete(id);
  }

  public async bulkPut(items: T[]): Promise<void> {
    const table = await this.getTable();
    await table.bulkPut(items);
  }
}

export class TestAwareRepository<T extends TestTaggedEntity> extends BaseRepository<T> {
  public async getTestRecords(): Promise<T[]> {
    const table = await this.getTable();
    const indexedRows = await table.where('recordOrigin').equals('test').toArray();
    return indexedRows.filter((row) => row.isTestData === true && row.recordOrigin === 'test');
  }

  public async getUserRecords(): Promise<T[]> {
    const table = await this.getTable();
    const indexedRows = await table.where('recordOrigin').equals('user').toArray();
    return indexedRows.filter((row) => row.isTestData !== true && row.recordOrigin !== 'test');
  }

  public async countByOrigin(): Promise<{ totalCount: number; userCount: number; testCount: number }> {
    const table = await this.getTable();
    const [totalCount, testCount] = await Promise.all([
      table.count(),
      table.where('recordOrigin').equals('test').count(),
    ]);
    return {
      totalCount,
      testCount,
      userCount: Math.max(0, totalCount - testCount),
    };
  }

  public async createTestRecord(
    payload: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'isTestData' | 'recordOrigin'> & { id?: string }
  ): Promise<T> {
    return this.create({
      ...payload,
      isTestData: true,
      recordOrigin: 'test',
    } as Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string });
  }

  /**
   * Safety-guarded deletion for verification workbench:
   * refuses to delete any record that is not explicitly marked as test data.
   */
  public async deleteTestRecordById(id: string): Promise<void> {
    const table = await this.getTable();
    const existing = await table.get(id);
    if (!existing) {
      return;
    }
    if (existing.isTestData !== true || existing.recordOrigin !== 'test') {
      throw new SafetyGuardError(
        `Blocked deletion of "${id}" in ${this.tableName}: only verification test records can be deleted from this workbench.`
      );
    }
    await table.delete(id);
  }

  /**
   * Safety-guarded bulk test cleanup:
   * ONLY deletes rows explicitly tagged with recordOrigin === 'test' AND isTestData === true.
   */
  public async deleteTestRecordsOnly(): Promise<number> {
    const table = await this.getTable();
    const testRows = await table.where('recordOrigin').equals('test').toArray();
    const safeIds = testRows
      .filter((row) => row.isTestData === true && row.recordOrigin === 'test')
      .map((row) => row.id);

    if (safeIds.length === 0) {
      return 0;
    }

    await table.bulkDelete(safeIds);
    return safeIds.length;
  }
}
