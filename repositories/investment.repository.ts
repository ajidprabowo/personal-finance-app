import { TestAwareRepository } from '@/repositories/base.repository';
import type {
  AssetClass,
  Holding,
  InvestmentActivity,
  InvestmentPlatform,
  PortfolioValuation,
  RecordOrigin,
} from '@/types/entities';

class InvestmentPlatformsRepository extends TestAwareRepository<InvestmentPlatform> {
  constructor() {
    super('investmentPlatforms');
  }
}

class AssetClassesRepository extends TestAwareRepository<AssetClass> {
  constructor() {
    super('assetClasses');
  }
}

class HoldingsRepository extends TestAwareRepository<Holding> {
  constructor() {
    super('holdings');
  }

  public async getByPlatformId(platformId: string): Promise<Holding[]> {
    const table = await this.getTable();
    return table.where('platformId').equals(platformId).toArray();
  }

  public async getByAssetClassId(assetClassId: string): Promise<Holding[]> {
    const table = await this.getTable();
    return table.where('assetClassId').equals(assetClassId).toArray();
  }
}

class InvestmentActivitiesRepository extends TestAwareRepository<InvestmentActivity> {
  constructor() {
    super('investmentActivities');
  }

  public async getByHoldingId(holdingId: string): Promise<InvestmentActivity[]> {
    const table = await this.getTable();
    return table.where('holdingId').equals(holdingId).sortBy('activityDate');
  }

  public async getByPlatformId(platformId: string): Promise<InvestmentActivity[]> {
    const table = await this.getTable();
    return table.where('platformId').equals(platformId).sortBy('activityDate');
  }

  public async getByOriginAndDateRange(
    origin: RecordOrigin,
    startDate?: string | null,
    endDate?: string | null
  ): Promise<InvestmentActivity[]> {
    const table = await this.getTable();
    if (startDate || endDate) {
      const lower = startDate ?? '';
      const upper = endDate ?? '\uffff';
      const rows = await table
        .where('[recordOrigin+activityDate]')
        .between([origin, lower], [origin, upper], true, true)
        .toArray();
      return rows.filter((r) =>
        origin === 'test'
          ? r.isTestData === true && r.recordOrigin === 'test'
          : r.isTestData !== true && r.recordOrigin !== 'test'
      );
    }
    return origin === 'test' ? this.getTestRecords() : this.getUserRecords();
  }
}

class PortfolioValuationsRepository extends TestAwareRepository<PortfolioValuation> {
  constructor() {
    super('portfolioValuations');
  }

  public async getByScope(scope: PortfolioValuation['scope']): Promise<PortfolioValuation[]> {
    const table = await this.getTable();
    return table.where('scope').equals(scope).sortBy('valuationDate');
  }

  public async getByOriginSorted(origin: RecordOrigin): Promise<PortfolioValuation[]> {
    const rows = origin === 'test' ? await this.getTestRecords() : await this.getUserRecords();
    return rows.sort(
      (a, b) =>
        a.valuationDate.localeCompare(b.valuationDate) || a.createdAt.localeCompare(b.createdAt)
    );
  }
}

export const investmentPlatformsRepository = new InvestmentPlatformsRepository();
export const assetClassesRepository = new AssetClassesRepository();
export const holdingsRepository = new HoldingsRepository();
export const investmentActivitiesRepository = new InvestmentActivitiesRepository();
export const portfolioValuationsRepository = new PortfolioValuationsRepository();

