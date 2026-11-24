import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import { validateDatabaseIntegrity } from '@/database/validator';
import { APP_CONFIG } from '@/lib/config';
import { ValidationError } from '@/lib/errors';
import {
  assetClassesRepository,
  holdingsRepository,
  investmentActivitiesRepository,
  portfolioValuationsRepository,
  transactionsRepository,
} from '@/repositories';
import { getAccountBalancesSnapshot, getNetWorthSnapshot } from '@/services/account-balance.service';
import { initializeApplication } from '@/services/bootstrap.service';
import { getFinancialSummaryForPeriod } from '@/services/financial-summary.service';
import { verifyDexieMigrationProbe } from '@/services/health.service';
import {
  contributeToInvestmentPool,
  convertCurrencyWithManualRate,
  createAssetClass,
  createHolding,
  createInvestmentPlatformWithCashAccount,
  createValuationSnapshot,
  deleteInvestmentActivity,
  ensureInvestmentPoolAccount,
  getInvestmentOverviewSnapshot,
  getInvestmentPoolSummary,
  getPlatformDetail,
  getPortfolioPerformanceHistory,
  listAssetClasses,
  recordBuyActivity,
  recordDividendActivity,
  recordFeeActivity,
  recordInterestActivity,
  recordSellActivity,
  recordValuationUpdateActivity,
  saveManualFxRate,
  transferBetweenPoolAndPlatform,
  updateInvestmentActivity,
  withdrawFromInvestmentPool,
} from '@/services/investment.service';
import { createUserAccount, toggleInvestmentPlatformStatus } from '@/services/settings.service';

async function resetLocalDatabaseForTest(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  await initializeApplication();
}

describe('Stage 4 — Investment Management & Portfolio Engine', () => {
  beforeEach(async () => {
    resetDatabaseInstance();
    await resetLocalDatabaseForTest();
  });

  it('1. Investment Pool contributions, withdrawals, and platform transfers preserve Net Worth and never count as income/expense', async () => {
    const bank = await createUserAccount({
      name: 'BCA Main',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 50_000_000,
    });

    const pool = await ensureInvestmentPoolAccount('IDR');
    const stockbit = await createInvestmentPlatformWithCashAccount({
      name: 'Stockbit Custom',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      supportsInvestmentPool: true,
    });

    const nwBefore = await getNetWorthSnapshot();
    assert.equal(nwBefore.byCurrency.IDR.liquidCashBalance, 50_000_000);
    assert.equal(nwBefore.byCurrency.IDR.totalInvestmentValue, 0);
    assert.equal(nwBefore.byCurrency.IDR.totalNetWorth, 50_000_000);

    // Contribute 20,000,000 from Main Bank -> Investment Pool
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 20_000_000,
      date: '2026-11-01',
    });

    // Transfer 15,000,000 from Pool -> Stockbit Platform Cash
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: stockbit.id,
      direction: 'pool_to_platform',
      amount: 15_000_000,
      date: '2026-11-02',
    });

    // Withdraw 2,000,000 from Pool -> Main Bank
    await withdrawFromInvestmentPool({
      sourceAccountId: pool.id,
      destinationAccountId: bank.id,
      amount: 2_000_000,
      date: '2026-11-03',
    });

    const nwAfter = await getNetWorthSnapshot();
    assert.equal(nwAfter.byCurrency.IDR.liquidCashBalance, 32_000_000);
    assert.equal(nwAfter.byCurrency.IDR.investmentPoolBalance, 3_000_000);
    assert.equal(nwAfter.byCurrency.IDR.platformCashBalance, 15_000_000);
    assert.equal(nwAfter.byCurrency.IDR.totalInvestmentValue, 18_000_000);
    assert.equal(nwAfter.byCurrency.IDR.totalNetWorth, 50_000_000);

    const poolSummary = await getInvestmentPoolSummary();
    assert.equal(poolSummary.totalsByCurrency.IDR.grossContributions, 20_000_000);
    assert.equal(poolSummary.totalsByCurrency.IDR.totalWithdrawals, 2_000_000);
    assert.equal(poolSummary.totalsByCurrency.IDR.netContributions, 18_000_000);
    assert.equal(poolSummary.totalsByCurrency.IDR.totalTransferredToPlatforms, 15_000_000);

    // Stage 3 personal income/expense summary must remain strictly unaffected by investment transfers
    const finSummary = await getFinancialSummaryForPeriod({ preset: 'all_time' });
    assert.equal(finSummary.byCurrency.IDR?.totalIncome ?? 0, 0);
    assert.equal(finSummary.byCurrency.IDR?.totalExpenses ?? 0, 0);
  });

  it('2. Platform creation, cash balance tracking, and disabled status guard', async () => {
    const pool = await ensureInvestmentPoolAccount('IDR');
    const bank = await createUserAccount({
      name: 'Mandiri',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 10_000_000,
      date: '2026-11-01',
    });

    const platform = await createInvestmentPlatformWithCashAccount({
      name: 'Bibit Pro',
      kind: 'mutual_fund',
      defaultCurrency: 'IDR',
      supportsInvestmentPool: true,
    });
    assert.ok(platform.cashAccountId);

    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: platform.id,
      amount: 6_000_000,
      date: '2026-11-02',
    });

    const detail = await getPlatformDetail(platform.id);
    assert.equal(detail.summary.cashBalance, 6_000_000);
    assert.equal(detail.summary.holdingsValue, 0);
    assert.equal(detail.summary.totalPlatformValue, 6_000_000);

    const classes = await listAssetClasses();
    const indoStock = classes.find((c) => c.code === 'INDO_STOCK')!;
    const holding = await createHolding({
      symbol: 'TLKM',
      name: 'Telkom Indonesia',
      platformId: platform.id,
      assetClassId: indoStock.id,
      currency: 'IDR',
    });

    await toggleInvestmentPlatformStatus(platform.id, true);
    await assert.rejects(
      () =>
        recordBuyActivity({
          platformId: platform.id,
          holdingId: holding.id,
          quantity: 100,
          unitPrice: 3000,
          activityDate: '2026-11-03',
        }),
      ValidationError
    );
  });

  it('3. Buy, Partial Sell, Full Sell, Weighted Average Cost, and Oversold rejection', async () => {
    const bank = await createUserAccount({
      name: 'BCA Main',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 25_000_000,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');
    const broker = await createInvestmentPlatformWithCashAccount({
      name: 'Stockbit',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
    });
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 20_000_000,
      date: '2026-11-01',
    });
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: broker.id,
      amount: 20_000_000,
      date: '2026-11-01',
    });

    const classes = await listAssetClasses();
    const indoStock = classes.find((c) => c.code === 'INDO_STOCK')!;
    const bbca = await createHolding({
      symbol: 'BBCA',
      name: 'Bank Central Asia Tbk',
      platformId: broker.id,
      assetClassId: indoStock.id,
      currency: 'IDR',
    });

    // Buy 1: 1,000 units @ 9,000 + fee 15,000 -> basis = 9,015,000, avgCost = 9,015
    const buy1 = await recordBuyActivity({
      platformId: broker.id,
      holdingId: bbca.id,
      quantity: 1000,
      unitPrice: 9000,
      feeAmount: 15_000,
      activityDate: '2026-11-02',
    });
    assert.equal(buy1.holding.quantity, 1000);
    assert.equal(buy1.holding.remainingCostBasis, 9_015_000);
    assert.equal(buy1.holding.averageCostPerUnit, 9015);

    // Buy 2: 500 units @ 9,600 + fee 12,000 -> gross = 4,800,000, total outflow = 4,812,000
    // Cumulative qty = 1,500, total basis = 13,827,000, avgCost = 9,218
    const buy2 = await recordBuyActivity({
      platformId: broker.id,
      holdingId: bbca.id,
      quantity: 500,
      unitPrice: 9600,
      feeAmount: 12_000,
      activityDate: '2026-11-05',
    });
    assert.equal(buy2.holding.quantity, 1500);
    assert.equal(buy2.holding.remainingCostBasis, 13_827_000);
    assert.equal(buy2.holding.averageCostPerUnit, 9218);

    // Platform cash should equal 20,000,000 - 9,015,000 - 4,812,000 = 6,173,000 (fee deducted once)
    let balances = await getAccountBalancesSnapshot();
    const cashAcc = balances.items.find((i) => i.account.id === broker.cashAccountId);
    assert.equal(cashAcc?.currentBalance, 6_173_000);

    // Partial Sell: 600 units @ 10,000 - fee 15,000
    // Gross = 6,000,000, Net proceeds = 5,985,000
    // Allocated basis = 600 / 1500 * 13,827,000 = 5,530,800
    // Realized P/L = 5,985,000 - 5,530,800 = 454,200
    // Remaining qty = 900, remaining basis = 8,296,200, avgCost = 9,218
    const sell1 = await recordSellActivity({
      platformId: broker.id,
      holdingId: bbca.id,
      quantity: 600,
      unitPrice: 10000,
      feeAmount: 15_000,
      activityDate: '2026-11-10',
    });
    assert.equal(sell1.activity.allocatedCostBasis, 5_530_800);
    assert.equal(sell1.activity.realizedPnl, 454_200);
    assert.equal(sell1.holding.quantity, 900);
    assert.equal(sell1.holding.remainingCostBasis, 8_296_200);
    assert.equal(sell1.holding.averageCostPerUnit, 9218);

    // Oversold check: cannot sell 901 units when only 900 available
    await assert.rejects(
      () =>
        recordSellActivity({
          platformId: broker.id,
          holdingId: bbca.id,
          quantity: 901,
          unitPrice: 10000,
          activityDate: '2026-11-11',
        }),
      ValidationError
    );

    // Subsequent Buy 3: 100 units @ 10,218 + fee 0 -> basis +1,021,800 => 9,318,000 / 1,000 = 9,318
    const buy3 = await recordBuyActivity({
      platformId: broker.id,
      holdingId: bbca.id,
      quantity: 100,
      unitPrice: 10218,
      feeAmount: 0,
      activityDate: '2026-11-12',
    });
    assert.equal(buy3.holding.quantity, 1000);
    assert.equal(buy3.holding.remainingCostBasis, 9_318_000);
    assert.equal(buy3.holding.averageCostPerUnit, 9318);

    // Full Sell of remaining 1,000 units @ 10,500 - fee 25,000
    // Net proceeds = 10,475,000, allocated = 9,318,000, realized P/L = 1,157,000
    const sell2 = await recordSellActivity({
      platformId: broker.id,
      holdingId: bbca.id,
      quantity: 1000,
      unitPrice: 10500,
      feeAmount: 25_000,
      activityDate: '2026-11-15',
    });
    assert.equal(sell2.holding.quantity, 0);
    assert.equal(sell2.holding.remainingCostBasis, 0);
    assert.equal(sell2.holding.averageCostPerUnit, 0);
    assert.equal(sell2.holding.realizedPnlTotal, 454_200 + 1_157_000);

    balances = await getAccountBalancesSnapshot();
    const cashAfterAll = balances.items.find((i) => i.account.id === broker.cashAccountId);
    // 6,173,000 + 5,985,000 - 1,021,800 + 10,475,000 = 21,611,200
    assert.equal(cashAfterAll?.currentBalance, 21_611_200);
  });

  it('4. Decimal-safe precision for fractional crypto quantities without floating-point drift', async () => {
    const pool = await ensureInvestmentPoolAccount('USDT');
    const exchange = await createInvestmentPlatformWithCashAccount({
      name: 'Bitget Custom',
      kind: 'crypto_exchange',
      defaultCurrency: 'USDT',
      initialCashBalance: 100_000,
    });
    assert.ok(pool);

    const cryptoClass = (await listAssetClasses()).find((c) => c.code === 'CRYPTO')!;
    const btc = await createHolding({
      symbol: 'BTC',
      name: 'Bitcoin',
      platformId: exchange.id,
      assetClassId: cryptoClass.id,
      currency: 'USDT',
    });

    await recordBuyActivity({
      platformId: exchange.id,
      holdingId: btc.id,
      quantity: 0.33333333,
      unitPrice: 60000,
      feeAmount: 10,
      activityDate: '2026-11-01',
    });
    const afterBuy2 = await recordBuyActivity({
      platformId: exchange.id,
      holdingId: btc.id,
      quantity: 0.66666667,
      unitPrice: 60000,
      feeAmount: 20,
      activityDate: '2026-11-02',
    });
    assert.equal(afterBuy2.holding.quantity, 1);
    assert.equal(afterBuy2.holding.remainingCostBasis, 60030);

    const afterSell = await recordSellActivity({
      platformId: exchange.id,
      holdingId: btc.id,
      quantity: 1,
      unitPrice: 65000,
      feeAmount: 30,
      activityDate: '2026-11-03',
    });
    assert.equal(afterSell.holding.quantity, 0);
    assert.equal(afterSell.holding.remainingCostBasis, 0);
    assert.equal(afterSell.activity.realizedPnl, 4940);
  });

  it('5. Dividends, Interest, Standalone Fees, and Manual Valuations update Platform Cash, Unrealized P/L, and History without altering Stage 3 Expenses/Income', async () => {
    const bank = await createUserAccount({
      name: 'Mandiri',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 10_000_000,
    });
    const pool = await ensureInvestmentPoolAccount('IDR');
    const broker = await createInvestmentPlatformWithCashAccount({
      name: 'Pluang Custom',
      kind: 'mutual_fund',
      defaultCurrency: 'IDR',
    });
    await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: pool.id,
      amount: 10_000_000,
      date: '2026-11-01',
    });
    await transferBetweenPoolAndPlatform({
      poolAccountId: pool.id,
      platformId: broker.id,
      amount: 10_000_000,
      date: '2026-11-01',
    });

    const goldClass = (await listAssetClasses()).find((c) => c.code === 'GOLD')!;
    const xau = await createHolding({
      symbol: 'XAU',
      name: 'Digital Gold',
      platformId: broker.id,
      assetClassId: goldClass.id,
      currency: 'IDR',
    });

    // Buy 5g @ 1,200,000 = 6,000,000 (Cash remaining: 4,000,000)
    await recordBuyActivity({
      platformId: broker.id,
      holdingId: xau.id,
      quantity: 5,
      unitPrice: 1_200_000,
      feeAmount: 0,
      activityDate: '2026-11-02',
    });

    // Dividend 300,000 minus 30,000 tax -> net +270,000 cash
    await recordDividendActivity({
      platformId: broker.id,
      holdingId: xau.id,
      amount: 300_000,
      feeAmount: 30_000,
      activityDate: '2026-11-05',
    });

    // Interest 80,000 -> net +80,000 cash
    await recordInterestActivity({
      platformId: broker.id,
      amount: 80_000,
      activityDate: '2026-11-06',
    });

    // Custody Fee 50,000 -> -50,000 cash
    await recordFeeActivity({
      platformId: broker.id,
      amount: 50_000,
      activityDate: '2026-11-07',
    });

    // Update Market Price -> 1,400,000 per g (Market Value = 7,000,000; Cost Basis = 6,000,000; Unrealized P/L = +1,000,000)
    const valRes = await recordValuationUpdateActivity({
      holdingId: xau.id,
      unitPrice: 1_400_000,
      valuationDate: '2026-11-10',
      recordSnapshot: true,
    });
    assert.equal(valRes.holding.currentMarketValue, 7_000_000);
    assert.equal(valRes.holding.remainingCostBasis, 6_000_000);
    assert.ok(valRes.snapshot);

    // Also record a portfolio-level snapshot on a different date
    await createValuationSnapshot({
      scope: 'portfolio',
      valuationDate: '2026-11-12',
      currency: 'IDR',
      marketValue: 11_300_000,
      costBasis: 6_000_000,
      notes: 'Mid-month check',
    });

    const overview = await getInvestmentOverviewSnapshot({ baseCurrency: 'IDR' });
    const idr = overview.byCurrency.IDR;
    // Platform cash = 4,000,000 + 270,000 + 80,000 - 50,000 = 4,300,000
    assert.equal(idr.platformCashBalance, 4_300_000);
    assert.equal(idr.holdingsMarketValue, 7_000_000);
    assert.equal(idr.totalInvestmentValue, 11_300_000);
    assert.equal(idr.unrealizedPnl, 1_000_000);
    assert.equal(idr.dividendIncome, 270_000);
    assert.equal(idr.interestIncome, 80_000);
    assert.equal(idr.totalFees, 50_000);
    // Total Investment Gain/Loss = 1,000,000 + 0 + 270,000 + 80,000 - 50,000 = 1,300,000
    assert.equal(idr.totalInvestmentGainLoss, 1_300_000);
    assert.equal(overview.netWorth.byCurrency.IDR.totalNetWorth, 11_300_000);

    // Personal income/expense totals remain 0
    const fin = await getFinancialSummaryForPeriod({ preset: 'all_time' });
    assert.equal(fin.byCurrency.IDR?.totalIncome ?? 0, 0);
    assert.equal(fin.byCurrency.IDR?.totalExpenses ?? 0, 0);

    const perf = await getPortfolioPerformanceHistory();
    assert.equal(perf.pointsByCurrency.IDR.length, 2);
  });

  it('6. Multi-currency holdings remain strictly separated until explicit manual FX rate is saved', async () => {
    const idrBroker = await createInvestmentPlatformWithCashAccount({
      name: 'Indo Broker',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      initialCashBalance: 1_000_000,
    });
    const usBroker = await createInvestmentPlatformWithCashAccount({
      name: 'US Broker',
      kind: 'brokerage',
      defaultCurrency: 'USD',
      initialCashBalance: 500,
    });

    const classes = await listAssetClasses();
    const indoClass = classes.find((c) => c.code === 'INDO_STOCK')!;
    const usClass = classes.find((c) => c.code === 'US_STOCK')!;

    const bbca = await createHolding({
      symbol: 'BBCA',
      name: 'BCA',
      platformId: idrBroker.id,
      assetClassId: indoClass.id,
      currency: 'IDR',
    });
    const nvda = await createHolding({
      symbol: 'NVDA',
      name: 'NVIDIA',
      platformId: usBroker.id,
      assetClassId: usClass.id,
      currency: 'USD',
    });

    await recordBuyActivity({
      platformId: idrBroker.id,
      holdingId: bbca.id,
      quantity: 100,
      unitPrice: 9000,
      activityDate: '2026-11-01',
    }); // 900,000 IDR + 100,000 cash = 1,000,000 IDR total
    await recordBuyActivity({
      platformId: usBroker.id,
      holdingId: nvda.id,
      quantity: 2,
      unitPrice: 120,
      activityDate: '2026-11-01',
    }); // 240 USD + 260 USD cash = 500 USD total
    await recordValuationUpdateActivity({
      holdingId: bbca.id,
      unitPrice: 9_000,
      valuationDate: '2026-11-10',
    });
    await recordValuationUpdateActivity({
      holdingId: nvda.id,
      unitPrice: 120,
      valuationDate: '2026-11-10',
    });

    // Missing FX rate must throw if explicit conversion attempted & mark canConvertAll = false
    assert.throws(() => convertCurrencyWithManualRate(500, 'USD', 'IDR', null), ValidationError);

    const beforeFx = await getInvestmentOverviewSnapshot({ baseCurrency: 'IDR' });
    assert.equal(beforeFx.byCurrency.IDR.totalInvestmentValue, 1_000_000);
    assert.equal(beforeFx.byCurrency.USD.totalInvestmentValue, 500);
    assert.equal(beforeFx.convertedTotals.canConvertAll, false);
    assert.deepEqual(beforeFx.convertedTotals.missingCurrencies, ['USD']);

    // Save explicit manual FX rate: 1 USD = 16,000 IDR
    await saveManualFxRate({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      rate: 16_000,
      date: '2026-11-10',
    });

    const afterFx = await getInvestmentOverviewSnapshot({ baseCurrency: 'IDR' });
    assert.equal(afterFx.convertedTotals.canConvertAll, true);
    assert.deepEqual(afterFx.convertedTotals.missingCurrencies, []);
    // 1,000,000 IDR + (500 USD * 16,000 = 8,000,000 IDR) = 9,000,000 IDR
    assert.equal(afterFx.convertedTotals.totalInvestmentValue, 9_000_000);
    assert.equal(afterFx.convertedTotals.totalNetWorth, 9_000_000);
  });

  it('7. Controlled Replay on Edit/Delete, Oversold Rollback, Duplicate Rules, and Validator Integrity', async () => {
    const brokerA = await createInvestmentPlatformWithCashAccount({
      name: 'Broker A',
      kind: 'brokerage',
      defaultCurrency: 'USD',
      initialCashBalance: 10_000,
    });
    const brokerB = await createInvestmentPlatformWithCashAccount({
      name: 'Broker B',
      kind: 'brokerage',
      defaultCurrency: 'USD',
      initialCashBalance: 5_000,
    });
    const customClass = await createAssetClass({ name: 'ETF Index', code: 'ETF' });

    const aaplA = await createHolding({
      symbol: 'AAPL',
      name: 'Apple Inc',
      platformId: brokerA.id,
      assetClassId: customClass.id,
      currency: 'USD',
    });

    // Same symbol allowed across different platforms, rejected on same platform+currency
    const aaplB = await createHolding({
      symbol: 'AAPL',
      name: 'Apple Inc',
      platformId: brokerB.id,
      assetClassId: customClass.id,
      currency: 'USD',
    });
    assert.notEqual(aaplA.id, aaplB.id);

    await assert.rejects(
      () =>
        createHolding({
          symbol: 'AAPL',
          name: 'Apple Inc Duplicate',
          platformId: brokerA.id,
          assetClassId: customClass.id,
          currency: 'USD',
        }),
      ValidationError
    );

    const buy1 = await recordBuyActivity({
      platformId: brokerA.id,
      holdingId: aaplA.id,
      quantity: 10,
      unitPrice: 100,
      feeAmount: 0,
      activityDate: '2026-11-01',
    });
    const sell1 = await recordSellActivity({
      platformId: brokerA.id,
      holdingId: aaplA.id,
      quantity: 6,
      unitPrice: 150,
      feeAmount: 0,
      activityDate: '2026-11-05',
    });
    assert.equal(sell1.activity.realizedPnl, 300); // 6*(150 - 100)

    // Edit earlier Buy1 price from 100 -> 120: Sell1 realized P/L must replay to 6*(150 - 120) = 180
    await updateInvestmentActivity(buy1.activity.id, { unitPrice: 120 });
    const replayedSell = await investmentActivitiesRepository.getById(sell1.activity.id);
    const replayedHolding = await holdingsRepository.getById(aaplA.id);
    assert.equal(replayedSell?.realizedPnl, 180);
    assert.equal(replayedHolding?.quantity, 4);
    assert.equal(replayedHolding?.remainingCostBasis, 480);

    // Attempt to delete Buy1 while Sell1 still exists -> must fail & roll back atomically!
    await assert.rejects(() => deleteInvestmentActivity(buy1.activity.id), ValidationError);
    const stillExists = await investmentActivitiesRepository.getById(buy1.activity.id);
    assert.ok(stillExists);

    // Linked pool transfer deletion cleans up both investmentActivity & paired transaction atomically
    const bank = await createUserAccount({
      name: 'Cash USD',
      type: 'bank',
      currency: 'USD',
      initialBalance: 1000,
    });
    const poolUsd = await ensureInvestmentPoolAccount('USD');
    const contrib = await contributeToInvestmentPool({
      sourceAccountId: bank.id,
      destinationAccountId: poolUsd.id,
      amount: 500,
      date: '2026-11-06',
    });
    await deleteInvestmentActivity(contrib.activity.id);
    assert.equal(await investmentActivitiesRepository.getById(contrib.activity.id), undefined);
    assert.equal(await transactionsRepository.getById(contrib.transaction.id), undefined);

    const validation = await validateDatabaseIntegrity();
    assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  });

  it('8. Manual prices drive valuation, retain dated history, and preserve weighted cost after partial sales', async () => {
    const broker = await createInvestmentPlatformWithCashAccount({
      name: 'Manual Price Broker',
      kind: 'brokerage',
      defaultCurrency: 'USD',
    });
    const stockClass = (await listAssetClasses()).find((item) => item.code === 'US_STOCK')!;
    const holding = await createHolding({
      symbol: 'TEST',
      name: 'Test Holding',
      platformId: broker.id,
      assetClassId: stockClass.id,
      currency: 'USD',
    });
    await recordBuyActivity({
      platformId: broker.id,
      holdingId: holding.id,
      quantity: 10,
      unitPrice: 50,
      activityDate: '2026-11-01',
    });

    let detail = await getPlatformDetail(broker.id);
    let enriched = detail.holdings.find((item) => item.holding.id === holding.id)!;
    assert.equal(enriched.priceRecorded, false);
    assert.equal(enriched.currentPrice, null);
    assert.equal(enriched.marketValue, 0);

    await recordValuationUpdateActivity({
      holdingId: holding.id,
      unitPrice: 60,
      valuationDate: '2026-11-20',
      notes: 'Closing price',
    });
    await recordSellActivity({
      platformId: broker.id,
      holdingId: holding.id,
      quantity: 4,
      unitPrice: 70,
      activityDate: '2026-11-21',
    });

    detail = await getPlatformDetail(broker.id);
    enriched = detail.holdings.find((item) => item.holding.id === holding.id)!;
    assert.equal(enriched.quantity, 6);
    assert.equal(enriched.remainingCostBasis, 300);
    assert.equal(enriched.currentPrice, 60);
    assert.equal(enriched.marketValue, 360);
    assert.equal(enriched.unrealizedPnl, 60);
    assert.equal(enriched.unrealizedPnlPct, 20);

    await recordValuationUpdateActivity({
      holdingId: holding.id,
      unitPrice: 55,
      valuationDate: '2026-11-10',
      notes: 'Backdated entry',
      recordSnapshot: false,
    });
    detail = await getPlatformDetail(broker.id);
    enriched = detail.holdings.find((item) => item.holding.id === holding.id)!;
    assert.equal(enriched.currentPrice, 60, 'latest dated price remains active');
    const history = (await portfolioValuationsRepository.getUserRecords()).filter(
      (item) => item.holdingId === holding.id
    );
    assert.equal(history.length, 2, 'all manual prices persist even when legacy option is false');
  });

  it('9. Schema v1->v8 migration probe & persistence reconstruction across DB reopen', async () => {
    const probe = await verifyDexieMigrationProbe();
    assert.equal(probe.passed, true, probe.notes);
    assert.equal(probe.testedToVersion, APP_CONFIG.currentSchemaVersion);

    const broker = await createInvestmentPlatformWithCashAccount({
      name: 'Persistent Broker',
      kind: 'brokerage',
      defaultCurrency: 'IDR',
      initialCashBalance: 5_000_000,
    });
    const indoClass = (await listAssetClasses()).find((c) => c.code === 'INDO_STOCK')!;
    const holding = await createHolding({
      symbol: 'BMRI',
      name: 'Bank Mandiri',
      platformId: broker.id,
      assetClassId: indoClass.id,
      currency: 'IDR',
    });
    await recordBuyActivity({
      platformId: broker.id,
      holdingId: holding.id,
      quantity: 100,
      unitPrice: 6000,
      feeAmount: 5000,
      activityDate: '2026-11-01',
    });
    await recordValuationUpdateActivity({
      holdingId: holding.id,
      unitPrice: 6500,
      valuationDate: '2026-11-10',
      recordSnapshot: true,
    });

    // Simulate closing and reopening the browser IndexedDB instance
    resetDatabaseInstance();
    await ensureDatabaseOpen();

    const overview = await getInvestmentOverviewSnapshot({ baseCurrency: 'IDR' });
    const persistedHolding = overview.holdings.find((h) => h.holding.id === holding.id);
    assert.ok(persistedHolding);
    assert.equal(persistedHolding.quantity, 100);
    assert.equal(persistedHolding.remainingCostBasis, 605_000);
    assert.equal(persistedHolding.marketValue, 650_000);
    assert.equal(persistedHolding.unrealizedPnl, 45_000);
    assert.equal(overview.byCurrency.IDR.platformCashBalance, 4_395_000);
    assert.equal((await portfolioValuationsRepository.getUserRecords()).length, 1);
    assert.equal((await assetClassesRepository.getUserRecords()).length >= 4, true);
  });
});
