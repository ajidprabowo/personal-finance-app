'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { SettingsSection } from '@/components/ui/settings-section';
import { SortableRow, reorderIds } from '@/components/shared/sortable-row';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import {
  createCustomInvestmentPlatform,
  deleteInvestmentPlatformSafely,
  listUserInvestmentPlatformsWithDetails,
  savePriorityOrder,
  toggleInvestmentPlatformStatus,
  updateInvestmentPlatform,
  type InvestmentPlatformWithDetails,
} from '@/services/settings.service';
import type { InvestmentPlatform, PlatformKind } from '@/types/entities';

const PLATFORM_KIND_LABELS: Record<PlatformKind, string> = {
  brokerage: 'Brokerage',
  mutual_fund: 'Mutual Fund',
  crypto_exchange: 'Crypto Exchange',
  bank_custodian: 'Bank Custodian',
  other: 'Other',
};

export function PlatformsManagementSection() {
  const { preferences } = useBootstrap();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const [details, setDetails] = useState<InvestmentPlatformWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlatformId, setExpandedPlatformId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<InvestmentPlatform | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlatformKind>('brokerage');
  const [defaultCurrency, setDefaultCurrency] = useState<string>(APP_CONFIG.defaultCurrency);
  const [supportsPool, setSupportsPool] = useState(true);
  const [isArchived, setIsArchived] = useState(false);

  const numberFormat = preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;

  const reload = useCallback(async () => {
    try {
      const rows = await listUserInvestmentPlatformsWithDetails();
      setDetails(rows);
    } catch (error) {
      notifyError('Failed to load investment platforms', error);
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    let active = true;
    listUserInvestmentPlatformsWithDetails()
      .then((rows) => {
        if (active) setDetails(rows);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load investment platforms', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const openAddModal = () => {
    setEditingPlatform(null);
    setName('');
    setKind('brokerage');
    setDefaultCurrency(preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency);
    setSupportsPool(true);
    setIsArchived(false);
    setModalOpen(true);
  };

  const openEditModal = (plat: InvestmentPlatform) => {
    setEditingPlatform(plat);
    setName(plat.name);
    setKind(plat.kind);
    setDefaultCurrency(plat.defaultCurrency);
    setSupportsPool(plat.supportsInvestmentPool);
    setIsArchived(plat.isArchived);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingPlatform) {
        await updateInvestmentPlatform(editingPlatform.id, {
          name,
          kind,
          defaultCurrency,
          supportsInvestmentPool: supportsPool,
          isArchived,
        });
        notifySuccess('Platform updated', `Saved changes to "${name.trim()}".`);
      } else {
        await createCustomInvestmentPlatform({
          name,
          kind,
          defaultCurrency,
          supportsInvestmentPool: supportsPool,
        });
        notifySuccess('Platform added', `Created "${name.trim()}" with linked cash account.`);
      }
      setModalOpen(false);
      await reload();
    } catch (error) {
      notifyError('Could not save platform', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (plat: InvestmentPlatform) => {
    try {
      const nextArchived = !plat.isArchived;
      await toggleInvestmentPlatformStatus(plat.id, nextArchived);
      notifySuccess(
        nextArchived ? 'Platform disabled' : 'Platform enabled',
        `${plat.name} is now ${nextArchived ? 'disabled' : 'enabled'}. Historical holdings remain preserved.`
      );
      await reload();
    } catch (error) {
      notifyError('Failed to update platform status', error);
    }
  };

  const handleDeletePlatform = async (item: InvestmentPlatformWithDetails) => {
    const plat = item.platform;
    const approved = await confirm({
      title: 'Delete Investment Platform',
      description: `Delete custom platform "${plat.name}" and its unused linked Platform Cash account?`,
      confirmLabel: 'Delete Platform',
      tone: 'danger',
    });
    if (!approved) return;

    try {
      await deleteInvestmentPlatformSafely(plat.id);
      notifySuccess('Platform deleted', `Removed "${plat.name}".`);
      await reload();
    } catch (error) {
      notifyError('Cannot delete platform', error);
    }
  };

  const handleReorder = async (draggedId: string, targetId: string) => {
    try {
      const ordered = reorderIds(details.map((item) => ({ ...item, id: item.platform.id })), draggedId, targetId);
      await savePriorityOrder('platforms', ordered.map((item) => item.platform.id));
      await reload();
    } catch (error) {
      notifyError('Could not save platform order', error);
    }
  };

  return (
    <>
      <SettingsSection
        id="platforms"
        title={t('settings.section.platforms')}
        description="Manage default and custom investment platforms, linked Platform Cash accounts, and holdings usage."
        action={
          <Button variant="outline" size="sm" onClick={openAddModal}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Platform</span>
          </Button>
        }
      >
        {loading ? (
          <div className="px-5 py-6 text-xs text-ink-muted">{t('common.loading')}</div>
        ) : (
          details.map((item) => {
            const plat = item.platform;
            const isExpanded = expandedPlatformId === plat.id;
            return (
              <SortableRow key={plat.id} id={plat.id} onMove={handleReorder} className="flex items-start gap-1 px-5">
                <div className="min-w-0 flex-1 divide-y divide-line/60">
                <div className="flex flex-col justify-between gap-3 py-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink">{plat.name}</p>
                      <span
                        className={
                          plat.isArchived
                            ? 'rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-status-warning'
                            : 'rounded border border-status-success/30 bg-status-success/10 px-1.5 py-0.5 text-[11px] font-medium text-status-success'
                        }
                      >
                        {plat.isArchived ? t('common.disabled') : t('common.enabled')}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-muted">
                      <span>{PLATFORM_KIND_LABELS[plat.kind] ?? plat.kind}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{plat.defaultCurrency}</span>
                      <span aria-hidden="true">·</span>
                      <span>{plat.supportsInvestmentPool ? 'Pool ready' : 'Direct'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {item.activeHoldingCount} active / {item.holdingCount} holdings
                      </span>
                      {item.cashAccount ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            Cash: {formatCurrency(item.cashBalance, item.cashAccount.currency, numberFormat)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {item.holdingCount > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedPlatformId((prev) => (prev === plat.id ? null : plat.id))
                        }
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>Holdings</span>
                      </Button>
                    ) : null}

                    <Button
                      variant={plat.isArchived ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => void handleToggleEnabled(plat)}
                    >
                      {plat.isArchived ? t('common.enable') : t('common.disable')}
                    </Button>

                    <IconButton
                      label={`Edit ${plat.name}`}
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(plat)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>

                    {plat.isDefault ? (
                      <IconButton
                        label={`${plat.name} is a protected default platform`}
                        variant="ghost"
                        size="sm"
                        disabled
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </IconButton>
                    ) : (
                      <IconButton
                        label={`Delete ${plat.name}`}
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDeletePlatform(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </div>
                </div>

                {isExpanded && item.holdings.length > 0 ? (
                  <div className="bg-surface-muted/50 px-5 py-3.5">
                    <p className="mb-2 text-xs font-medium text-ink-muted">
                      Holdings on {plat.name}
                    </p>
                    <div className="divide-y divide-line rounded-lg border border-line bg-surface">
                      {item.holdings.map((h) => (
                        <div
                          key={h.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-ink">{h.name}</span>
                            {h.symbol ? (
                              <span className="ml-1.5 font-mono text-[11px] text-ink-muted">
                                ({h.symbol})
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-3 font-mono tabular-nums text-ink-muted">
                            <span>Qty: {h.quantity}</span>
                            <span className="font-medium text-ink">
                              {formatCurrency(h.currentMarketValue ?? 0, h.currency, numberFormat)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                </div>
              </SortableRow>
            );
          })
        )}
      </SettingsSection>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingPlatform ? 'Edit Investment Platform' : 'Add Custom Platform'}
        description="Adding a platform automatically provisions a linked Platform Cash account."
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Input
            label="Platform Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bareksa"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Platform Type"
              value={kind}
              onChange={(e) => setKind(e.target.value as PlatformKind)}
              options={[
                { value: 'brokerage', label: 'Brokerage' },
                { value: 'mutual_fund', label: 'Mutual Fund' },
                { value: 'crypto_exchange', label: 'Crypto Exchange' },
                { value: 'bank_custodian', label: 'Bank Custodian' },
                { value: 'other', label: 'Other' },
              ]}
            />

            <Select
              label="Default Currency"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              options={APP_CONFIG.supportedCurrencies.map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.name}`,
              }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Investment Pool Support"
              value={supportsPool ? 'yes' : 'no'}
              onChange={(e) => setSupportsPool(e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Supports Pool & Cash Balance' },
                { value: 'no', label: 'Holdings Only' },
              ]}
            />

            <Select
              label="Status"
              value={isArchived ? 'disabled' : 'enabled'}
              onChange={(e) => setIsArchived(e.target.value === 'disabled')}
              options={[
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled / Archived' },
              ]}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {editingPlatform ? t('common.saveChanges') : 'Create Platform'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
