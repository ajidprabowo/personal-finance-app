import { BaseRepository } from '@/repositories/base.repository';
import type {
  AppInstallation,
  EmailConnection,
  EmailImportHistory,
  UserPreferences,
} from '@/types/entities';

class AppInstallationRepository extends BaseRepository<AppInstallation> {
  constructor() {
    super('appInstallation');
  }

  public async getSingleton(): Promise<AppInstallation | undefined> {
    const table = await this.getTable();
    const rows = await table.limit(1).toArray();
    return rows[0];
  }

  public async getByInstallationId(installationId: string): Promise<AppInstallation | undefined> {
    const table = await this.getTable();
    return table.where('installationId').equals(installationId).first();
  }
}

class PreferencesRepository extends BaseRepository<UserPreferences> {
  constructor() {
    super('preferences');
  }

  public async getByInstallationId(installationId: string): Promise<UserPreferences | undefined> {
    const table = await this.getTable();
    return table.where('installationId').equals(installationId).first();
  }
}

class EmailConnectionsRepository extends BaseRepository<EmailConnection> {
  constructor() {
    super('emailConnections');
  }

  public async getByInstallationId(installationId: string): Promise<EmailConnection[]> {
    const table = await this.getTable();
    return table.where('installationId').equals(installationId).toArray();
  }
}

class EmailImportHistoryRepository extends BaseRepository<EmailImportHistory> {
  constructor() {
    super('emailImportHistory');
  }

  public async getByConnectionId(connectionId: string): Promise<EmailImportHistory[]> {
    const table = await this.getTable();
    return table.where('connectionId').equals(connectionId).toArray();
  }
}

export const appInstallationRepository = new AppInstallationRepository();
export const preferencesRepository = new PreferencesRepository();
export const emailConnectionsRepository = new EmailConnectionsRepository();
export const emailImportHistoryRepository = new EmailImportHistoryRepository();
