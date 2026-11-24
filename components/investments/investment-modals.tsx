'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency, formatNumericValue } from '@/lib/currency';
import { formatDisplayDate, todayDateString } from '@/lib/dates';
import { normalizeErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { AccountBalanceItem } from '@/services/account-balance.service';
import {
  computeBuyPositionUpdate,
  computeSellPositionUpdate,
  createAssetClass,
  createHolding,
  createInvestmentPlatformWithCashAccount,
  createValuationSnapshot,
  deleteInvestmentActivity,
  recordBuyActivity,
  recordDividendActivity,
  recordFeeActivity,
  recordInterestActivity,
  recordSellActivity,
  recordValuationUpdateActivity,
  removeManualFxRate,
  saveManualFxRate,
  transferBetweenPoolAndPlatform,
  updateAssetClass,
  updateHoldingMetadata,
  updateInvestmentActivity,
  updateInvestmentPlatformInfo,
  withdrawFromInvestmentPool,
  contributeToInvestmentPool,
  type EnrichedInvestmentActivity,
  type HoldingEnriched,
  type PlatformWithMetrics,
} from '@/services/investment.service';
import type {
  Account,
  AssetClass,
  DateFormatPreference,
  ManualFxRateEntry,
  NumberFormatPreference,
  PlatformKind,
} from '@/types/entities';

const CURRENCY_OPTIONS = [
  { value: 'IDR', label: 'IDR — Indonesian Rupiah' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USDT', label: 'USDT — Tether USD' },
  { value: 'USDC', label: 'USDC — USD Coin' },
  { value: 'BTC', label: 'BTC — Bitcoin' },
  { value: 'ETH', label: 'ETH — Ethereum' },
];

const PLATFORM_KIND_OPTIONS: Array<{ value: PlatformKind; label: string }> = [
  { value: 'brokerage', label: 'Stock / Multi-Asset Brokerage' },
  { value: 'mutual_fund', label: 'Mutual Fund / Wealth App' },
  { value: 'crypto_exchange', label: 'Crypto Exchange' },
  { value: 'bank_custodian', label: 'Bank Custodian / Gold' },
  { value: 'other', label: 'Other Custodian' },
];

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2.5 text-xs text-status-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// =============================================================================
// 1. Investment Pool Transfer Modal
// =============================================================================

export type PoolTransferMode = 'contribute' | 'withdraw' | 'platform_transfer';

export interface PoolTransferModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  initialMode?: PoolTransferMode;
  initialPlatformId?: string;
  poolAccounts: AccountBalanceItem[];
  mainAccounts: AccountBalanceItem[];
  platforms: PlatformWithMetrics[];
  timezone: string;
  numberFormat: NumberFormatPreference;
}

function PoolTransferBody({
  onClose,
  onSaved,
  initialMode,
  initialPlatformId,
  poolAccounts,
  mainAccounts,
  platforms,
  timezone,
  numberFormat,
}: Omit<PoolTransferModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const [mode, setMode] = useState<PoolTransferMode>(initialMode ?? 'contribute');
  const [direction, setDirection] = useState<'pool_to_platform' | 'platform_to_pool'>(
    'pool_to_platform'
  );
  const [poolAccountId, setPoolAccountId] = useState<string>(poolAccounts[0]?.account.id ?? '');
  const [mainAccountId, setMainAccountId] = useState<string>(() => {
    const firstPoolCurrency = poolAccounts[0]?.account.currency;
    return (
      mainAccounts.find((m) => m.account.currency === firstPoolCurrency)?.account.id ??
      mainAccounts[0]?.account.id ??
      ''
    );
  });
  const [platformId, setPlatformId] = useState<string>(() => {
    if (initialPlatformId) return initialPlatformId;
    const enabled = platforms.filter((p) => !p.platform.isArchived);
    const firstPoolCurrency = poolAccounts[0]?.account.currency;
    return (
      enabled.find((p) => p.currency === firstPoolCurrency)?.platform.id ??
      enabled[0]?.platform.id ??
      ''
    );
  });
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(todayDateString(timezone));
  const [description, setDescription] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPool = poolAccounts.find((p) => p.account.id === poolAccountId);
  const selectedMain = mainAccounts.find((m) => m.account.id === mainAccountId);
  const selectedPlatform = platforms.find((p) => p.platform.id === platformId);
  const enabledPlatforms = platforms.filter((p) => !p.platform.isArchived);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'contribute') {
        await contributeToInvestmentPool({
          sourceAccountId: mainAccountId,
          destinationAccountId: poolAccountId,
          amount: numAmount,
          date,
          description: description || undefined,
          notes: notes || undefined,
        });
        notifySuccess('Contribution recorded to Investment Pool.');
      } else if (mode === 'withdraw') {
        await withdrawFromInvestmentPool({
          sourceAccountId: poolAccountId,
          destinationAccountId: mainAccountId,
          amount: numAmount,
          date,
          description: description || undefined,
          notes: notes || undefined,
        });
        notifySuccess('Withdrawal from Investment Pool to Main Balance recorded.');
      } else {
        await transferBetweenPoolAndPlatform({
          poolAccountId,
          platformId,
          direction,
          amount: numAmount,
          date,
          description: description || undefined,
          notes: notes || undefined,
        });
        notifySuccess('Platform transfer recorded.');
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { id: 'contribute', label: 'Contribute' },
            { id: 'withdraw', label: 'Withdraw' },
            { id: 'platform_transfer', label: 'Platform' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              setError(null);
            }}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
              mode === tab.id
                ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                : 'border-line bg-surface-muted/40 text-ink hover:bg-surface-muted'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {mode === 'platform_transfer' ? (
        <Select
          label="Transfer Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'pool_to_platform' | 'platform_to_pool')}
          options={[
            { value: 'pool_to_platform', label: 'Investment Pool -> Platform Cash' },
            { value: 'platform_to_pool', label: 'Platform Cash -> Investment Pool' },
          ]}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {mode !== 'platform_transfer' ? (
          <Select
            label={mode === 'contribute' ? 'From Main Account' : 'To Main Account'}
            value={mainAccountId}
            onChange={(e) => setMainAccountId(e.target.value)}
            options={mainAccounts.map((m) => ({
              value: m.account.id,
              label: `${m.account.name} (${formatCurrency(m.currentBalance, m.account.currency, numberFormat)})`,
            }))}
          />
        ) : null}

        <Select
          label={
            mode === 'contribute'
              ? 'To Investment Pool'
              : mode === 'withdraw'
                ? 'From Investment Pool'
                : 'Investment Pool'
          }
          value={poolAccountId}
          onChange={(e) => setPoolAccountId(e.target.value)}
          options={poolAccounts.map((p) => ({
            value: p.account.id,
            label: `${p.account.name} (${formatCurrency(p.currentBalance, p.account.currency, numberFormat)})`,
          }))}
        />

        {mode === 'platform_transfer' ? (
          <Select
            label="Investment Platform"
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
            options={enabledPlatforms.map((p) => ({
              value: p.platform.id,
              label: `${p.platform.name} (${formatCurrency(p.cashBalance, p.currency, numberFormat)})`,
            }))}
          />
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={`Amount (${
            mode === 'platform_transfer'
              ? (selectedPool?.account.currency ?? selectedPlatform?.currency ?? 'IDR')
              : (selectedMain?.account.currency ?? selectedPool?.account.currency ?? 'IDR')
          })`}
          type="number"
          step="any"
          min="0"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 5000000"
        />
        <Input
          label="Transfer Date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <Input
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={
          mode === 'contribute'
            ? 'Monthly investment allocation'
            : mode === 'withdraw'
              ? 'Return idle cash to bank'
              : 'Top up brokerage cash'
        }
      />

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional reference notes"
      />

      <p className="rounded-lg border border-line bg-surface-muted/40 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
        <ArrowLeftRight className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
        Recorded as an internal capital allocation transfer. It updates account balances immediately
        without distorting personal Income or Expense totals or double-counting Net Worth.
      </p>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Recording...' : 'Confirm Transfer'}
        </Button>
      </div>
    </form>
  );
}

export function PoolTransferModal(props: PoolTransferModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Investment Pool & Platform Transfers"
      description="Allocate capital between Main Balance, Investment Pool, and Platform Cash accounts."
    >
      <PoolTransferBody
        key={`${props.open ? 'open' : 'closed'}-${props.initialMode ?? 'contribute'}-${props.initialPlatformId ?? ''}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        initialMode={props.initialMode}
        initialPlatformId={props.initialPlatformId}
        poolAccounts={props.poolAccounts}
        mainAccounts={props.mainAccounts}
        platforms={props.platforms}
        timezone={props.timezone}
        numberFormat={props.numberFormat}
      />
    </Modal>
  );
}

// =============================================================================
// 2. Holding Create / Edit Modal
// =============================================================================

export interface HoldingModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  platforms: PlatformWithMetrics[];
  assetClasses: AssetClass[];
  initialPlatformId?: string;
  editingHolding?: HoldingEnriched | null;
}

function HoldingFormBody({
  onClose,
  onSaved,
  platforms,
  assetClasses,
  initialPlatformId,
  editingHolding,
}: Omit<HoldingModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const isEditing = Boolean(editingHolding);
  const enabledPlatforms = platforms.filter(
    (p) => !p.platform.isArchived || p.platform.id === editingHolding?.holding.platformId
  );
  const enabledClasses = assetClasses.filter(
    (c) => !c.isArchived || c.id === editingHolding?.holding.assetClassId
  );

  const defaultPlatId =
    editingHolding?.holding.platformId ??
    initialPlatformId ??
    enabledPlatforms[0]?.platform.id ??
    '';
  const defaultPlatCurrency =
    enabledPlatforms.find((p) => p.platform.id === defaultPlatId)?.currency ??
    APP_CONFIG.defaultCurrency;

  const [symbol, setSymbol] = useState<string>(editingHolding?.holding.symbol ?? '');
  const [name, setName] = useState<string>(editingHolding?.holding.name ?? '');
  const [platformId, setPlatformId] = useState<string>(defaultPlatId);
  const [assetClassId, setAssetClassId] = useState<string>(
    editingHolding?.holding.assetClassId ?? enabledClasses[0]?.id ?? ''
  );
  const [currency, setCurrency] = useState<string>(
    editingHolding?.holding.currency ?? defaultPlatCurrency
  );
  const [currentPrice, setCurrentPrice] = useState<string>(
    editingHolding?.holding.currentPrice !== undefined
      ? String(editingHolding.holding.currentPrice)
      : ''
  );
  const [notes, setNotes] = useState<string>(editingHolding?.holding.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isEditing && editingHolding) {
        await updateHoldingMetadata(editingHolding.holding.id, {
          symbol,
          name,
          assetClassId,
          notes,
        });
        notifySuccess(`Holding ${symbol.toUpperCase()} updated.`);
      } else {
        const parsedPrice = currentPrice.trim() ? Number(currentPrice) : undefined;
        await createHolding({
          symbol,
          name,
          platformId,
          assetClassId,
          currency,
          currentPrice: parsedPrice,
          notes,
        });
        notifySuccess(`Holding ${symbol.toUpperCase()} created.`);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Ticker / Symbol"
          required
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="e.g. BBCA, NVDA, BTC, XAU"
        />
        <Input
          label="Asset Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Bank Central Asia Tbk"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Platform"
          disabled={isEditing}
          value={platformId}
          onChange={(e) => {
            const nextId = e.target.value;
            setPlatformId(nextId);
            const plat = enabledPlatforms.find((p) => p.platform.id === nextId);
            if (plat) setCurrency(plat.currency);
          }}
          options={enabledPlatforms.map((p) => ({
            value: p.platform.id,
            label: `${p.platform.name} (${p.currency})`,
          }))}
        />

        <Select
          label="Asset Class"
          value={assetClassId}
          onChange={(e) => setAssetClassId(e.target.value)}
          options={enabledClasses.map((c) => ({
            value: c.id,
            label: `${c.name} (${c.code})`,
          }))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Holding Currency"
          disabled={isEditing}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          options={CURRENCY_OPTIONS}
        />
        {!isEditing ? (
          <Input
            label="Initial Market Price (optional)"
            type="number"
            step="any"
            min="0"
            value={currentPrice}
            onChange={(e) => setCurrentPrice(e.target.value)}
            placeholder="Optional starting price"
          />
        ) : null}
      </div>

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Thesis, custody notes, or lot details"
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Holding'}
        </Button>
      </div>
    </form>
  );
}

export function HoldingModal(props: HoldingModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.editingHolding ? `Edit ${props.editingHolding.holding.symbol}` : 'Add Investment Holding'}
      description="Holdings are tracked uniquely per platform, ticker symbol, and currency."
    >
      <HoldingFormBody
        key={`${props.open ? 'open' : 'closed'}-${props.editingHolding?.holding.id ?? 'new'}-${props.initialPlatformId ?? ''}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        platforms={props.platforms}
        assetClasses={props.assetClasses}
        initialPlatformId={props.initialPlatformId}
        editingHolding={props.editingHolding}
      />
    </Modal>
  );
}

// =============================================================================
// 3. Trade / Dividend / Interest / Fee Modal
// =============================================================================

export type TradeActivityMode = 'buy' | 'sell' | 'dividend' | 'interest' | 'fee';

export interface TradeOrIncomeModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  initialMode?: TradeActivityMode;
  initialHolding?: HoldingEnriched | null;
  platforms: PlatformWithMetrics[];
  holdings: HoldingEnriched[];
  timezone: string;
  numberFormat: NumberFormatPreference;
}

function TradeOrIncomeBody({
  onClose,
  onSaved,
  initialMode,
  initialHolding,
  platforms,
  holdings,
  timezone,
  numberFormat,
}: Omit<TradeOrIncomeModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const enabledPlatforms = platforms.filter((p) => !p.platform.isArchived);

  const startMode: TradeActivityMode = initialMode ?? 'buy';
  const startPlatformId =
    initialHolding?.holding.platformId ?? enabledPlatforms[0]?.platform.id ?? '';
  const holdingsOnStartPlat = holdings.filter((h) => h.holding.platformId === startPlatformId);
  const startHoldingId =
    initialHolding?.holding.id ?? holdingsOnStartPlat[0]?.holding.id ?? '';

  const [mode, setMode] = useState<TradeActivityMode>(startMode);
  const [platformId, setPlatformId] = useState<string>(startPlatformId);
  const [holdingId, setHoldingId] = useState<string>(startHoldingId);
  const [quantity, setQuantity] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>(
    initialHolding?.currentPrice ? String(initialHolding.currentPrice) : ''
  );
  const [amount, setAmount] = useState<string>('');
  const [feeAmount, setFeeAmount] = useState<string>('0');
  const [activityDate, setActivityDate] = useState<string>(todayDateString(timezone));
  const [description, setDescription] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlatform = platforms.find((p) => p.platform.id === platformId);
  const platformHoldings = useMemo(
    () => holdings.filter((h) => h.holding.platformId === platformId),
    [holdings, platformId]
  );
  const selectedHolding = platformHoldings.find((h) => h.holding.id === holdingId);
  const activeCurrency = selectedHolding?.holding.currency ?? selectedPlatform?.currency ?? 'IDR';

  const preview = useMemo(() => {
    if (mode !== 'buy' && mode !== 'sell') return null;
    if (!selectedHolding) return null;
    const qty = Number(quantity);
    const price = Number(unitPrice);
    const fee = Math.max(0, Number(feeAmount) || 0);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return null;

    try {
      if (mode === 'buy') {
        const res = computeBuyPositionUpdate(
          {
            quantity: selectedHolding.quantity,
            remainingCostBasis: selectedHolding.remainingCostBasis,
            averageCostPerUnit: selectedHolding.averageCostPerUnit,
            realizedPnlTotal: selectedHolding.realizedPnlTotal,
            currency: activeCurrency,
          },
          { quantity: qty, unitPrice: price, feeAmount: fee }
        );
        return { kind: 'buy' as const, res };
      }
      const res = computeSellPositionUpdate(
        {
          quantity: selectedHolding.quantity,
          remainingCostBasis: selectedHolding.remainingCostBasis,
          averageCostPerUnit: selectedHolding.averageCostPerUnit,
          realizedPnlTotal: selectedHolding.realizedPnlTotal,
          currency: activeCurrency,
        },
        { quantity: qty, unitPrice: price, feeAmount: fee }
      );
      return { kind: 'sell' as const, res };
    } catch (err) {
      return { kind: 'error' as const, message: normalizeErrorMessage(err) };
    }
  }, [mode, selectedHolding, quantity, unitPrice, feeAmount, activeCurrency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === 'buy') {
        if (!holdingId) throw new Error('Create or select a holding on this platform first.');
        await recordBuyActivity({
          platformId,
          holdingId,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          feeAmount: Number(feeAmount) || 0,
          activityDate,
          notes: notes || undefined,
        });
        notifySuccess(`Buy recorded for ${selectedHolding?.holding.symbol ?? 'holding'}.`);
      } else if (mode === 'sell') {
        if (!holdingId) throw new Error('Select a holding to sell.');
        await recordSellActivity({
          platformId,
          holdingId,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          feeAmount: Number(feeAmount) || 0,
          activityDate,
          notes: notes || undefined,
        });
        notifySuccess(`Sell recorded for ${selectedHolding?.holding.symbol ?? 'holding'}.`);
      } else if (mode === 'dividend') {
        await recordDividendActivity({
          platformId,
          holdingId: holdingId || undefined,
          amount: Number(amount),
          feeAmount: Number(feeAmount) || 0,
          activityDate,
          description: description || undefined,
          notes: notes || undefined,
        });
        notifySuccess('Dividend income recorded into platform cash.');
      } else if (mode === 'interest') {
        await recordInterestActivity({
          platformId,
          holdingId: holdingId || undefined,
          amount: Number(amount),
          feeAmount: Number(feeAmount) || 0,
          activityDate,
          description: description || undefined,
          notes: notes || undefined,
        });
        notifySuccess('Investment interest recorded into platform cash.');
      } else {
        await recordFeeActivity({
          platformId,
          holdingId: holdingId || undefined,
          amount: Number(amount),
          activityDate,
          description: description || undefined,
          notes: notes || undefined,
        });
        notifySuccess('Platform fee deducted from platform cash.');
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-5 gap-1.5">
        {(
          [
            { id: 'buy', label: 'Buy' },
            { id: 'sell', label: 'Sell' },
            { id: 'dividend', label: 'Dividend' },
            { id: 'interest', label: 'Interest' },
            { id: 'fee', label: 'Fee' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              setError(null);
            }}
            className={cn(
              'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
              mode === tab.id
                ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                : 'border-line bg-surface-muted/40 text-ink hover:bg-surface-muted'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Platform"
          value={platformId}
          onChange={(e) => {
            const nextPlat = e.target.value;
            setPlatformId(nextPlat);
            const match = holdings.find((h) => h.holding.platformId === nextPlat);
            setHoldingId(match?.holding.id ?? '');
          }}
          options={enabledPlatforms.map((p) => ({
            value: p.platform.id,
            label: `${p.platform.name} (${formatCurrency(p.cashBalance, p.currency, numberFormat)})`,
          }))}
        />

        <Select
          label={mode === 'buy' || mode === 'sell' ? 'Holding' : 'Holding (optional)'}
          value={holdingId}
          onChange={(e) => {
            const nextId = e.target.value;
            setHoldingId(nextId);
            const h = platformHoldings.find((item) => item.holding.id === nextId);
            if (h && h.currentPrice > 0 && !unitPrice) {
              setUnitPrice(String(h.currentPrice));
            }
          }}
          options={[
            ...(mode === 'dividend' || mode === 'interest' || mode === 'fee'
              ? [{ value: '', label: 'Platform-wide (no specific holding)' }]
              : []),
            ...(platformHoldings.length === 0 && (mode === 'buy' || mode === 'sell')
              ? [{ value: '', label: 'No holdings on this platform yet' }]
              : platformHoldings.map((h) => ({
                  value: h.holding.id,
                  label: `${h.holding.symbol} — Qty ${formatNumericValue(
                    h.quantity,
                    h.quantity % 1 === 0 ? 0 : 4,
                    numberFormat
                  )}`,
                }))),
          ]}
        />
      </div>

      {mode === 'buy' || mode === 'sell' ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Quantity"
            type="number"
            step="any"
            min="0"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            helperText={
              mode === 'sell' && selectedHolding
                ? `Available: ${formatNumericValue(
                    selectedHolding.quantity,
                    selectedHolding.quantity % 1 === 0 ? 0 : 4,
                    numberFormat
                  )}`
                : undefined
            }
          />
          <Input
            label={`Unit Price (${activeCurrency})`}
            type="number"
            step="any"
            min="0"
            required
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
          <Input
            label={`Fee (${activeCurrency})`}
            type="number"
            step="any"
            min="0"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={
              mode === 'fee'
                ? `Fee Amount (${activeCurrency})`
                : `Gross ${mode === 'dividend' ? 'Dividend' : 'Interest'} (${activeCurrency})`
            }
            type="number"
            step="any"
            min="0"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {mode !== 'fee' ? (
            <Input
              label={`Tax / Fee Withheld (${activeCurrency})`}
              type="number"
              step="any"
              min="0"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
            />
          ) : null}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Activity Date"
          type="date"
          required
          value={activityDate}
          onChange={(e) => setActivityDate(e.target.value)}
        />
        {mode !== 'buy' && mode !== 'sell' ? (
          <Input
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={`Optional ${mode} description`}
          />
        ) : (
          <Input
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Broker order ref or notes"
          />
        )}
      </div>

      {mode !== 'buy' && mode !== 'sell' ? (
        <Input
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional reference notes"
        />
      ) : null}

      {preview ? (
        preview.kind === 'error' ? (
          <ErrorBanner message={preview.message} />
        ) : preview.kind === 'buy' ? (
          <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs tabular-nums">
            <div className="flex justify-between">
              <span className="text-ink-muted">Gross Purchase</span>
              <span className="font-medium text-ink">
                {formatCurrency(preview.res.grossAmount, activeCurrency, numberFormat)}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-ink-muted">Total Cash Outflow (incl. fee)</span>
              <span className="font-semibold text-status-danger">
                -{formatCurrency(preview.res.totalCashOutflow, activeCurrency, numberFormat)}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-1.5">
              <span className="text-ink-muted">Projected Avg Cost / Unit</span>
              <span className="font-semibold text-ink">
                {formatCurrency(preview.res.newAverageCostPerUnit, activeCurrency, numberFormat)}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-xs tabular-nums">
            <div className="flex justify-between">
              <span className="text-ink-muted">Net Cash Proceeds</span>
              <span className="font-semibold text-status-success">
                +{formatCurrency(preview.res.netProceeds, activeCurrency, numberFormat)}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-ink-muted">Allocated Cost Basis (Avg Cost)</span>
              <span className="text-ink">
                {formatCurrency(preview.res.allocatedCostBasis, activeCurrency, numberFormat)}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-1.5">
              <span className="text-ink-muted">Realized P/L</span>
              <span
                className={cn(
                  'font-semibold',
                  preview.res.realizedPnl >= 0 ? 'text-status-success' : 'text-status-danger'
                )}
              >
                {preview.res.realizedPnl > 0 ? '+' : ''}
                {formatCurrency(preview.res.realizedPnl, activeCurrency, numberFormat)}
              </span>
            </div>
          </div>
        )
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Recording...' : 'Record Activity'}
        </Button>
      </div>
    </form>
  );
}

export function TradeOrIncomeModal(props: TradeOrIncomeModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Record Investment Activity"
      description="Buy, sell, dividend, interest, and fee events settle directly against the platform cash account."
      maxWidthClassName="max-w-xl"
    >
      <TradeOrIncomeBody
        key={`${props.open ? 'open' : 'closed'}-${props.initialMode ?? 'buy'}-${props.initialHolding?.holding.id ?? 'none'}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        initialMode={props.initialMode}
        initialHolding={props.initialHolding}
        platforms={props.platforms}
        holdings={props.holdings}
        timezone={props.timezone}
        numberFormat={props.numberFormat}
      />
    </Modal>
  );
}

// =============================================================================
// 4. Holding Valuation Update Modal
// =============================================================================

export interface ValuationUpdateModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  holding: HoldingEnriched | null;
  baseCurrency: string;
  timezone: string;
  numberFormat: NumberFormatPreference;
}

function ValuationUpdateBody({
  onClose,
  onSaved,
  holding,
  baseCurrency,
  timezone,
  numberFormat,
}: Omit<ValuationUpdateModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const [inputMode, setInputMode] = useState<'unit_price' | 'market_value'>('unit_price');
  const [unitPrice, setUnitPrice] = useState<string>(
    holding?.currentPrice ? String(holding.currentPrice) : ''
  );
  const [marketValue, setMarketValue] = useState<string>(
    holding?.marketValue ? String(holding.marketValue) : ''
  );
  const [valuationDate, setValuationDate] = useState<string>(todayDateString(timezone));
  const [fxRateToBase, setFxRateToBase] = useState<string>('');
  const [recordSnapshot, setRecordSnapshot] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!holding) return null;

  const isForeign = holding.holding.currency.toUpperCase() !== baseCurrency.toUpperCase();
  const projectedValue =
    inputMode === 'unit_price'
      ? Math.max(0, (Number(unitPrice) || 0) * holding.quantity)
      : Math.max(0, Number(marketValue) || 0);
  const projectedPnl = projectedValue - holding.remainingCostBasis;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await recordValuationUpdateActivity({
        holdingId: holding.holding.id,
        unitPrice: inputMode === 'unit_price' ? Number(unitPrice) : undefined,
        marketValue: inputMode === 'market_value' ? Number(marketValue) : undefined,
        valuationDate,
        fxRateToBase: fxRateToBase.trim() ? Number(fxRateToBase) : undefined,
        baseCurrency,
        recordSnapshot,
        notes: notes || undefined,
      });
      notifySuccess(`Valuation updated for ${holding.holding.symbol}.`);
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-line bg-surface-muted/40 px-3 py-2.5 text-xs">
        <p className="font-semibold text-ink">
          {holding.holding.symbol} — {holding.holding.name}
        </p>
        <p className="mt-0.5 tabular-nums text-ink-muted">
          Qty: {formatNumericValue(holding.quantity, holding.quantity % 1 === 0 ? 0 : 4, numberFormat)} ·
          Remaining Cost Basis:{' '}
          {formatCurrency(holding.remainingCostBasis, holding.holding.currency, numberFormat)}
        </p>
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setInputMode('unit_price')}
          className={cn(
            'rounded-lg border px-3 py-2 text-xs font-medium',
            inputMode === 'unit_price'
              ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
              : 'border-line bg-surface text-ink'
          )}
        >
          Update by Unit Price
        </button>
        <button
          type="button"
          onClick={() => setInputMode('market_value')}
          className={cn(
            'rounded-lg border px-3 py-2 text-xs font-medium',
            inputMode === 'market_value'
              ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
              : 'border-line bg-surface text-ink'
          )}
        >
          Update by Market Value
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {inputMode === 'unit_price' ? (
          <Input
            label={`Current Market Price (${holding.holding.currency})`}
            type="number"
            step="any"
            min="0"
            required
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        ) : (
          <Input
            label={`Total Market Value (${holding.holding.currency})`}
            type="number"
            step="any"
            min="0"
            required
            value={marketValue}
            onChange={(e) => setMarketValue(e.target.value)}
          />
        )}
        <Input
          label="Valuation Date"
          type="date"
          required
          value={valuationDate}
          onChange={(e) => setValuationDate(e.target.value)}
        />
      </div>

      {isForeign ? (
        <Input
          label={`Optional Manual FX Rate (1 ${holding.holding.currency} -> ${baseCurrency})`}
          type="number"
          step="any"
          min="0"
          value={fxRateToBase}
          onChange={(e) => setFxRateToBase(e.target.value)}
          placeholder="e.g. 16000"
        />
      ) : null}

      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={recordSnapshot}
          onChange={(e) => setRecordSnapshot(e.target.checked)}
          className="h-4 w-4 rounded border-line"
        />
        <span>Also save a historical valuation snapshot</span>
      </label>

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Manual price source or closing quote note"
      />

      <div className="flex items-center justify-between rounded-lg border border-line bg-surface-muted/40 px-3 py-2 text-xs tabular-nums">
        <span className="text-ink-muted">Projected Unrealized P/L</span>
        <span
          className={cn(
            'font-semibold',
            projectedPnl >= 0 ? 'text-status-success' : 'text-status-danger'
          )}
        >
          {projectedPnl > 0 ? '+' : ''}
          {formatCurrency(projectedPnl, holding.holding.currency, numberFormat)}
        </span>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Updating...' : 'Save Valuation'}
        </Button>
      </div>
    </form>
  );
}

export function ValuationUpdateModal(props: ValuationUpdateModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Update Manual Market Valuation"
      description="Updates market value and unrealized P/L without altering holding cost basis or cash balances."
    >
      <ValuationUpdateBody
        key={`${props.open ? 'open' : 'closed'}-${props.holding?.holding.id ?? 'none'}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        holding={props.holding}
        baseCurrency={props.baseCurrency}
        timezone={props.timezone}
        numberFormat={props.numberFormat}
      />
    </Modal>
  );
}

// =============================================================================
// 5. Portfolio / Platform Snapshot Modal
// =============================================================================

export interface PortfolioSnapshotModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  platforms: PlatformWithMetrics[];
  baseCurrency: string;
  timezone: string;
  defaultMarketValue?: number;
  defaultCostBasis?: number;
  defaultCurrency?: string;
}

function PortfolioSnapshotBody({
  onClose,
  onSaved,
  platforms,
  baseCurrency,
  timezone,
  defaultMarketValue,
  defaultCostBasis,
  defaultCurrency,
}: Omit<PortfolioSnapshotModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const [scope, setScope] = useState<'portfolio' | 'platform'>('portfolio');
  const [platformId, setPlatformId] = useState<string>(platforms[0]?.platform.id ?? '');
  const [valuationDate, setValuationDate] = useState<string>(todayDateString(timezone));
  const [currency, setCurrency] = useState<string>(defaultCurrency || baseCurrency);
  const [marketValue, setMarketValue] = useState<string>(
    defaultMarketValue !== undefined ? String(defaultMarketValue) : ''
  );
  const [costBasis, setCostBasis] = useState<string>(
    defaultCostBasis !== undefined ? String(defaultCostBasis) : ''
  );
  const [fxRateToBase, setFxRateToBase] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createValuationSnapshot({
        scope,
        platformId: scope === 'platform' ? platformId : undefined,
        valuationDate,
        currency,
        marketValue: Number(marketValue),
        costBasis: costBasis.trim() ? Number(costBasis) : undefined,
        fxRateToBase: fxRateToBase.trim() ? Number(fxRateToBase) : undefined,
        baseCurrency,
        notes: notes || undefined,
      });
      notifySuccess('Valuation snapshot saved.');
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Snapshot Scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'portfolio' | 'platform')}
          options={[
            { value: 'portfolio', label: 'Entire Portfolio (per Currency)' },
            { value: 'platform', label: 'Single Platform' },
          ]}
        />
        {scope === 'platform' ? (
          <Select
            label="Platform"
            value={platformId}
            onChange={(e) => {
              const id = e.target.value;
              setPlatformId(id);
              const plat = platforms.find((p) => p.platform.id === id);
              if (plat) setCurrency(plat.currency);
            }}
            options={platforms.map((p) => ({
              value: p.platform.id,
              label: `${p.platform.name} (${p.currency})`,
            }))}
          />
        ) : (
          <Select
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            options={CURRENCY_OPTIONS}
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Snapshot Date"
          type="date"
          required
          value={valuationDate}
          onChange={(e) => setValuationDate(e.target.value)}
        />
        <Input
          label={`Market Value (${currency})`}
          type="number"
          step="any"
          min="0"
          required
          value={marketValue}
          onChange={(e) => setMarketValue(e.target.value)}
        />
        <Input
          label={`Cost Basis (${currency})`}
          type="number"
          step="any"
          min="0"
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
        />
      </div>

      {currency.toUpperCase() !== baseCurrency.toUpperCase() ? (
        <Input
          label={`Optional FX Rate (1 ${currency} -> ${baseCurrency})`}
          type="number"
          step="any"
          min="0"
          value={fxRateToBase}
          onChange={(e) => setFxRateToBase(e.target.value)}
        />
      ) : null}

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Month-end portfolio checkpoint"
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Saving...' : 'Save Snapshot'}
        </Button>
      </div>
    </form>
  );
}

export function PortfolioSnapshotModal(props: PortfolioSnapshotModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Record Performance Snapshot"
      description="Save a point-in-time manual valuation checkpoint for historical performance tracking."
    >
      <PortfolioSnapshotBody
        key={`${props.open ? 'open' : 'closed'}-${props.defaultCurrency ?? props.baseCurrency}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        platforms={props.platforms}
        baseCurrency={props.baseCurrency}
        timezone={props.timezone}
        defaultMarketValue={props.defaultMarketValue}
        defaultCostBasis={props.defaultCostBasis}
        defaultCurrency={props.defaultCurrency}
      />
    </Modal>
  );
}

// =============================================================================
// 6. Platform Create / Edit Modal
// =============================================================================

export interface PlatformModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  editingPlatform?: PlatformWithMetrics | null;
}

function PlatformFormBody({
  onClose,
  onSaved,
  editingPlatform,
}: Omit<PlatformModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const isEditing = Boolean(editingPlatform);

  const [name, setName] = useState<string>(editingPlatform?.platform.name ?? '');
  const [kind, setKind] = useState<PlatformKind>(
    editingPlatform?.platform.kind ?? 'brokerage'
  );
  const [defaultCurrency, setDefaultCurrency] = useState<string>(
    editingPlatform?.platform.defaultCurrency ?? 'IDR'
  );
  const [initialCashBalance, setInitialCashBalance] = useState<string>('0');
  const [supportsInvestmentPool, setSupportsInvestmentPool] = useState<boolean>(
    editingPlatform?.platform.supportsInvestmentPool ?? true
  );
  const [isArchived, setIsArchived] = useState<boolean>(
    editingPlatform?.platform.isArchived ?? false
  );
  const [notes, setNotes] = useState<string>(editingPlatform?.platform.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isEditing && editingPlatform) {
        await updateInvestmentPlatformInfo(editingPlatform.platform.id, {
          name,
          kind,
          defaultCurrency,
          supportsInvestmentPool,
          isArchived,
          notes,
        });
        notifySuccess(`Platform "${name}" updated.`);
      } else {
        await createInvestmentPlatformWithCashAccount({
          name,
          kind,
          defaultCurrency,
          supportsInvestmentPool,
          initialCashBalance: Number(initialCashBalance) || 0,
          notes,
        });
        notifySuccess(`Platform "${name}" created with a linked cash account.`);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Platform Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Interactive Brokers, Ajaib, Binance"
        />
        <Select
          label="Platform Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as PlatformKind)}
          options={PLATFORM_KIND_OPTIONS}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Platform Currency"
          value={defaultCurrency}
          onChange={(e) => setDefaultCurrency(e.target.value)}
          options={CURRENCY_OPTIONS}
        />
        {!isEditing ? (
          <Input
            label={`Opening Cash Balance (${defaultCurrency})`}
            type="number"
            step="any"
            min="0"
            value={initialCashBalance}
            onChange={(e) => setInitialCashBalance(e.target.value)}
          />
        ) : null}
      </div>

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Custody notes or broker details"
      />

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={supportsInvestmentPool}
            onChange={(e) => setSupportsInvestmentPool(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          <span>Allow transfers between Investment Pool and this platform</span>
        </label>

        {isEditing ? (
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={isArchived}
              onChange={(e) => setIsArchived(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            <span>Disable platform (keeps historical records intact)</span>
          </label>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Platform'}
        </Button>
      </div>
    </form>
  );
}

export function PlatformModal(props: PlatformModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.editingPlatform ? `Edit ${props.editingPlatform.platform.name}` : 'Add Investment Platform'}
      description="Every platform includes a dedicated investment cash account tracked in the unified balance engine."
    >
      <PlatformFormBody
        key={`${props.open ? 'open' : 'closed'}-${props.editingPlatform?.platform.id ?? 'new'}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        editingPlatform={props.editingPlatform}
      />
    </Modal>
  );
}

// =============================================================================
// 7. Asset Class Create / Edit Modal
// =============================================================================

export interface AssetClassModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  editingAssetClass?: AssetClass | null;
}

function AssetClassFormBody({
  onClose,
  onSaved,
  editingAssetClass,
}: Omit<AssetClassModalProps, 'open'>) {
  const { notifySuccess } = useNotifications();
  const isEditing = Boolean(editingAssetClass);
  const [name, setName] = useState<string>(editingAssetClass?.name ?? '');
  const [code, setCode] = useState<string>(editingAssetClass?.code ?? '');
  const [description, setDescription] = useState<string>(editingAssetClass?.description ?? '');
  const [isArchived, setIsArchived] = useState<boolean>(editingAssetClass?.isArchived ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isEditing && editingAssetClass) {
        await updateAssetClass(editingAssetClass.id, {
          name,
          description,
          isArchived,
        });
        notifySuccess(`Asset class "${name}" updated.`);
      } else {
        await createAssetClass({ name, code, description });
        notifySuccess(`Asset class "${name}" created.`);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Asset Class Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mutual Funds, Bonds, REITs"
        />
        <Input
          label="Code"
          disabled={isEditing}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. BOND (optional)"
        />
      </div>
      <Input
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Short classification note"
      />
      {isEditing ? (
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={isArchived}
            onChange={(e) => setIsArchived(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          <span>Disable asset class for new holdings</span>
        </label>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Asset Class'}
        </Button>
      </div>
    </form>
  );
}

export function AssetClassModal(props: AssetClassModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.editingAssetClass ? `Edit ${props.editingAssetClass.name}` : 'Add Asset Class'}
      description="Organize your investment holdings into clear asset categories."
    >
      <AssetClassFormBody
        key={`${props.open ? 'open' : 'closed'}-${props.editingAssetClass?.id ?? 'new'}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        editingAssetClass={props.editingAssetClass}
      />
    </Modal>
  );
}

// =============================================================================
// 8. Manual FX Rates Modal
// =============================================================================

export interface FxRateModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  baseCurrency: string;
  rates: ManualFxRateEntry[];
  missingCurrencies: string[];
  timezone: string;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}

function FxRateBody({
  onClose,
  onSaved,
  baseCurrency,
  rates,
  missingCurrencies,
  timezone,
  numberFormat,
  dateFormat,
}: Omit<FxRateModalProps, 'open'>) {
  const { notifySuccess, notifyError } = useNotifications();
  const [fromCurrency, setFromCurrency] = useState<string>(
    missingCurrencies[0] ?? (baseCurrency === 'USD' ? 'IDR' : 'USD')
  );
  const [rateInput, setRateInput] = useState<string>('');
  const [rateDate, setRateDate] = useState<string>(todayDateString(timezone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await saveManualFxRate({
        fromCurrency,
        toCurrency: baseCurrency,
        rate: Number(rateInput),
        date: rateDate,
      });
      notifySuccess(`Saved manual FX rate: 1 ${fromCurrency} = ${rateInput} ${baseCurrency}.`);
      setRateInput('');
      await onSaved();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (from: string, to: string) => {
    try {
      await removeManualFxRate(from, to);
      notifySuccess(`Removed FX rate ${from} -> ${to}.`);
      await onSaved();
    } catch (err) {
      notifyError('Failed to remove FX rate', err);
    }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {missingCurrencies.length > 0 ? (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-ink">
          Manual FX rate required to convert{' '}
          <span className="font-mono font-semibold">{missingCurrencies.join(', ')}</span> into{' '}
          <span className="font-mono font-semibold">{baseCurrency}</span>.
        </div>
      ) : null}

      <form onSubmit={handleSave} className="space-y-3 rounded-lg border border-line bg-surface-muted/30 p-3.5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Source Currency"
            value={fromCurrency}
            onChange={(e) => setFromCurrency(e.target.value)}
            options={CURRENCY_OPTIONS.filter((c) => c.value !== baseCurrency)}
          />
          <Input
            label={`1 ${fromCurrency} in ${baseCurrency}`}
            type="number"
            step="any"
            min="0"
            required
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            placeholder={baseCurrency === 'IDR' ? 'e.g. 16000' : 'e.g. 1.0'}
          />
          <Input
            label="Rate Date"
            type="date"
            required
            value={rateDate}
            onChange={(e) => setRateDate(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={saving}>
            {saving ? 'Saving...' : 'Save Manual FX Rate'}
          </Button>
        </div>
      </form>

      <div>
        <p className="mb-2 text-xs font-semibold text-ink">Saved Manual FX Rates</p>
        {rates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">
            No manual FX rates recorded yet. Multi-currency portfolios remain strictly separated by
            native currency until rates are provided.
          </p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {rates.map((r) => (
              <div
                key={`${r.fromCurrency}_${r.toCurrency}`}
                className="flex items-center justify-between px-3 py-2.5 text-xs"
              >
                <div>
                  <p className="font-mono font-semibold text-ink">
                    1 {r.fromCurrency} = {formatNumericValue(r.rate, 2, numberFormat)} {r.toCurrency}
                  </p>
                  <p className="text-[11px] tabular-nums text-ink-muted">
                    Effective {formatDisplayDate(r.date, dateFormat)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(r.fromCurrency, r.toCurrency)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-status-danger" aria-hidden="true" />
                  <span className="text-status-danger">Remove</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-1">
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function FxRateModal(props: FxRateModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Manual FX Exchange Rates"
      description="Explicit local exchange rates used for consolidated base-currency reporting. No external FX APIs are called."
    >
      <FxRateBody
        key={`${props.open ? 'open' : 'closed'}-${props.baseCurrency}-${props.rates.length}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        baseCurrency={props.baseCurrency}
        rates={props.rates}
        missingCurrencies={props.missingCurrencies}
        timezone={props.timezone}
        numberFormat={props.numberFormat}
        dateFormat={props.dateFormat}
      />
    </Modal>
  );
}

// =============================================================================
// 9. Activity Detail / Controlled Edit / Atomic Delete Modal
// =============================================================================

export interface ActivityDetailModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  item: EnrichedInvestmentActivity | null;
  numberFormat: NumberFormatPreference;
  dateFormat: DateFormatPreference;
}

function ActivityDetailBody({
  onClose,
  onSaved,
  item,
  numberFormat,
  dateFormat,
}: Omit<ActivityDetailModalProps, 'open'>) {
  const { confirm } = useConfirmDialog();
  const { notifySuccess } = useNotifications();
  const [editing, setEditing] = useState(false);

  const act = item?.activity;
  const [activityDate, setActivityDate] = useState<string>(act?.activityDate ?? '');
  const [quantity, setQuantity] = useState<string>(
    act?.quantity !== undefined ? String(act.quantity) : ''
  );
  const [unitPrice, setUnitPrice] = useState<string>(
    act?.unitPrice !== undefined ? String(act.unitPrice) : ''
  );
  const [grossAmount, setGrossAmount] = useState<string>(
    act ? String(act.activityType === 'fee' ? act.feeAmount : act.grossAmount) : ''
  );
  const [feeAmount, setFeeAmount] = useState<string>(act ? String(act.feeAmount) : '0');
  const [description, setDescription] = useState<string>(act?.description ?? '');
  const [notes, setNotes] = useState<string>(act?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item || !act) return null;

  const isTrade =
    act.activityType === 'buy' ||
    act.activityType === 'sell' ||
    act.activityType === 'partial_sell';
  const isTransfer =
    act.activityType === 'contribution' ||
    act.activityType === 'withdrawal' ||
    act.activityType === 'platform_transfer';
  const isValuation =
    act.activityType === 'valuation_update' || act.activityType === 'valuation_adjustment';

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateInvestmentActivity(act.id, {
        activityDate,
        quantity: isTrade ? Number(quantity) : undefined,
        unitPrice: isTrade || isValuation ? Number(unitPrice) : undefined,
        grossAmount: !isTrade && !isValuation ? Number(grossAmount) : undefined,
        feeAmount: isTrade || (!isTransfer && !isValuation) ? Number(feeAmount) : undefined,
        description,
        notes,
      });
      notifySuccess('Investment activity updated and holding metrics replayed.');
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Investment Activity?',
      description: isTransfer
        ? 'Deleting this capital transfer will also remove its paired internal transfer entry and update both account balances.'
        : isTrade
          ? 'Deleting this trade will chronologically replay cost basis and realized P/L for the holding. Deletion will be blocked if a subsequent sale would exceed remaining units.'
          : 'This activity will be permanently deleted from local IndexedDB storage.',
      confirmLabel: 'Delete Activity',
      tone: 'danger',
    });
    if (!ok) return;

    setError(null);
    setSaving(true);
    try {
      await deleteInvestmentActivity(act.id);
      notifySuccess('Investment activity deleted.');
      await onSaved();
      onClose();
    } catch (err) {
      setError(normalizeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {!editing ? (
        <>
          <div className="divide-y divide-line rounded-lg border border-line text-xs">
            <div className="flex justify-between px-3.5 py-2.5">
              <span className="text-ink-muted">Activity Type</span>
              <span className="font-semibold capitalize text-ink">
                {act.activityType.replace('_', ' ')}
              </span>
            </div>
            <div className="flex justify-between px-3.5 py-2.5">
              <span className="text-ink-muted">Date</span>
              <span className="tabular-nums text-ink">
                {formatDisplayDate(act.activityDate, dateFormat)}
              </span>
            </div>
            <div className="flex justify-between px-3.5 py-2.5">
              <span className="text-ink-muted">Platform</span>
              <span className="font-medium text-ink">{item.platformName}</span>
            </div>
            {item.holdingSymbol ? (
              <div className="flex justify-between px-3.5 py-2.5">
                <span className="text-ink-muted">Holding</span>
                <span className="font-semibold text-ink">
                  {item.holdingSymbol} — {item.holdingName}
                </span>
              </div>
            ) : null}
            {act.quantity !== undefined ? (
              <div className="flex justify-between px-3.5 py-2.5">
                <span className="text-ink-muted">Quantity</span>
                <span className="font-mono tabular-nums text-ink">
                  {formatNumericValue(act.quantity, act.quantity % 1 === 0 ? 0 : 4, numberFormat)}
                </span>
              </div>
            ) : null}
            {act.unitPrice !== undefined ? (
              <div className="flex justify-between px-3.5 py-2.5">
                <span className="text-ink-muted">Unit Price</span>
                <span className="tabular-nums text-ink">
                  {formatCurrency(act.unitPrice, act.currency, numberFormat)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between px-3.5 py-2.5">
              <span className="text-ink-muted">Gross Amount</span>
              <span className="tabular-nums text-ink">
                {formatCurrency(act.grossAmount, act.currency, numberFormat)}
              </span>
            </div>
            <div className="flex justify-between px-3.5 py-2.5">
              <span className="text-ink-muted">Fee / Tax</span>
              <span className="tabular-nums text-ink">
                {formatCurrency(act.feeAmount, act.currency, numberFormat)}
              </span>
            </div>
            {act.netAmount !== undefined ? (
              <div className="flex justify-between px-3.5 py-2.5">
                <span className="text-ink-muted">Net Cash Impact</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatCurrency(act.netAmount, act.currency, numberFormat)}
                </span>
              </div>
            ) : null}
            {act.allocatedCostBasis !== undefined ? (
              <div className="flex justify-between px-3.5 py-2.5">
                <span className="text-ink-muted">Allocated Cost Basis</span>
                <span className="tabular-nums text-ink">
                  {formatCurrency(act.allocatedCostBasis, act.currency, numberFormat)}
                </span>
              </div>
            ) : null}
            {act.realizedPnl !== undefined ? (
              <div className="flex justify-between px-3.5 py-2.5">
                <span className="text-ink-muted">Realized P/L</span>
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    act.realizedPnl >= 0 ? 'text-status-success' : 'text-status-danger'
                  )}
                >
                  {act.realizedPnl > 0 ? '+' : ''}
                  {formatCurrency(act.realizedPnl, act.currency, numberFormat)}
                </span>
              </div>
            ) : null}
            {act.notes ? (
              <div className="px-3.5 py-2.5">
                <span className="text-ink-muted">Notes:</span>{' '}
                <span className="text-ink">{act.notes}</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="danger" size="sm" onClick={handleDelete} loading={saving}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Delete</span>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Edit</span>
              </Button>
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </>
      ) : (
        <form onSubmit={handleSaveEdit} className="space-y-3">
          <Input
            label="Activity Date"
            type="date"
            required
            value={activityDate}
            onChange={(e) => setActivityDate(e.target.value)}
          />

          {isTrade ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Quantity"
                type="number"
                step="any"
                min="0"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <Input
                label={`Unit Price (${act.currency})`}
                type="number"
                step="any"
                min="0"
                required
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
              <Input
                label={`Fee (${act.currency})`}
                type="number"
                step="any"
                min="0"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
              />
            </div>
          ) : isValuation ? (
            <Input
              label={`Unit Price (${act.currency})`}
              type="number"
              step="any"
              min="0"
              required
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={`${act.activityType === 'fee' ? 'Fee Amount' : 'Amount'} (${act.currency})`}
                type="number"
                step="any"
                min="0"
                required
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
              />
              {!isTransfer && act.activityType !== 'fee' ? (
                <Input
                  label={`Fee / Tax (${act.currency})`}
                  type="number"
                  step="any"
                  min="0"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                />
              ) : null}
            </div>
          )}

          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              Back
            </Button>
            <Button type="submit" loading={saving}>
              {saving ? 'Replaying...' : 'Save & Replay'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ActivityDetailAndEditModal(props: ActivityDetailModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Investment Activity Details"
      description="Inspect, edit, or delete this activity with full chronological cost-basis consistency."
    >
      <ActivityDetailBody
        key={`${props.open ? 'open' : 'closed'}-${props.item?.activity.id ?? 'none'}`}
        onClose={props.onClose}
        onSaved={props.onSaved}
        item={props.item}
        numberFormat={props.numberFormat}
        dateFormat={props.dateFormat}
      />
    </Modal>
  );
}
