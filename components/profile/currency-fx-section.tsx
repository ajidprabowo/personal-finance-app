'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSection } from '@/components/ui/settings-section';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatDisplayDate, todayDateString } from '@/lib/dates';
import {
  getManualFxRates,
  removeManualFxRateById,
  saveManualFxRate,
} from '@/services/portfolio-valuation.service';
import { updateUserPreferences } from '@/services/settings.service';
import type { ManualFxRateEntry } from '@/types/entities';

export function CurrencyFxSection() {
  const { installation, preferences, refreshBootstrap } = useBootstrap();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const [rates, setRates] = useState<ManualFxRateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingBase, setUpdatingBase] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ManualFxRateEntry | null>(null);
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState<string>(APP_CONFIG.defaultCurrency);
  const [rateInput, setRateInput] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes, setNotes] = useState('');

  const baseCurrency = preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency;
  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;
  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;

  const reload = useCallback(async () => {
    try {
      const list = await getManualFxRates();
      setRates(list);
    } catch (error) {
      notifyError('Failed to load exchange rates', error);
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    let active = true;
    getManualFxRates()
      .then((list) => {
        if (active) setRates(list);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load exchange rates', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const handleBaseCurrencyChange = async (nextBase: string) => {
    if (!installation?.installationId) return;
    setUpdatingBase(true);
    try {
      await updateUserPreferences(installation.installationId, { baseCurrency: nextBase });
      await refreshBootstrap();
      notifySuccess('Base currency updated', `Reporting currency set to ${nextBase}.`);
    } catch (error) {
      notifyError('Failed to update base currency', error);
    } finally {
      setUpdatingBase(false);
    }
  };

  const openAddModal = () => {
    setEditingEntry(null);
    setFromCurrency(baseCurrency === 'USD' ? 'SGD' : 'USD');
    setToCurrency(baseCurrency);
    setRateInput('');
    setEffectiveDate(todayDateString(timezone));
    setNotes('');
    setModalOpen(true);
  };

  const openEditModal = (entry: ManualFxRateEntry) => {
    setEditingEntry(entry);
    setFromCurrency(entry.fromCurrency);
    setToCurrency(entry.toCurrency);
    setRateInput(String(entry.rate));
    setEffectiveDate(entry.date);
    setNotes(entry.notes ?? '');
    setModalOpen(true);
  };

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericRate = Number(rateInput);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      notifyError('Invalid exchange rate', 'Please enter a positive rate greater than zero.');
      return;
    }

    setSaving(true);
    try {
      await saveManualFxRate({
        id: editingEntry?.id,
        fromCurrency,
        toCurrency,
        rate: numericRate,
        date: effectiveDate,
        notes,
      });
      await refreshBootstrap();
      await reload();
      setModalOpen(false);
      notifySuccess(
        editingEntry ? 'FX rate updated' : 'FX rate saved',
        `1 ${fromCurrency} = ${numericRate} ${toCurrency} effective ${effectiveDate}.`
      );
    } catch (error) {
      notifyError('Failed to save exchange rate', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRate = async (entry: ManualFxRateEntry) => {
    const approved = await confirm({
      title: 'Delete Exchange Rate Entry',
      description: `Remove 1 ${entry.fromCurrency} = ${entry.rate} ${entry.toCurrency} (effective ${formatDisplayDate(entry.date, dateFormat)})?`,
      confirmLabel: 'Delete Rate',
      tone: 'danger',
    });
    if (!approved) return;

    try {
      const targetId = entry.id || `${entry.fromCurrency}_${entry.toCurrency}_${entry.date}`;
      await removeManualFxRateById(targetId);
      await refreshBootstrap();
      await reload();
      notifySuccess('FX rate removed', 'Deleted manual exchange rate entry.');
    } catch (error) {
      notifyError('Could not remove FX rate', error);
    }
  };

  return (
    <>
      <SettingsSection
        id="currency-fx"
        title={t('settings.section.currencyFx')}
        description="Configure your base reporting currency and maintain dated manual FX rates. Historical entries on distinct effective dates are preserved; unrated currencies are never fabricated or blindly merged."
        action={
          <Button variant="outline" size="sm" onClick={openAddModal}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add FX Rate</span>
          </Button>
        }
      >
        <SettingsItem
          label="Base Reporting Currency"
          description="Used as the target currency across Dashboard, Analytics, and Investments summaries."
          control={
            <div className="w-56">
              <Select
                aria-label="Base Reporting Currency"
                value={baseCurrency}
                disabled={updatingBase}
                onChange={(e) => void handleBaseCurrencyChange(e.target.value)}
                options={APP_CONFIG.supportedCurrencies.map((c) => ({
                  value: c.code,
                  label: `${c.code} — ${c.name}`,
                }))}
              />
            </div>
          }
        />

        <SettingsItem
          label="Supported Currency Reference"
          description="Built-in currency formatting definitions available across accounts, transactions, and holdings."
          layout="stack"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {APP_CONFIG.supportedCurrencies.map((c) => (
              <div
                key={c.code}
                className="rounded-lg border border-line bg-surface-muted/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between font-mono font-semibold text-ink">
                  <span>{c.code}</span>
                  <span className="text-ink-muted">{c.symbol}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-ink-muted">{c.name}</p>
              </div>
            ))}
          </div>
        </SettingsItem>

        <SettingsItem
          label="Manual Exchange Rate Entries"
          description="Saving a rate on a new effective date keeps prior historical dates intact so past monthly reports remain consistent."
          layout="stack"
        >
          {loading ? (
            <p className="text-xs text-ink-muted">{t('common.loading')}</p>
          ) : rates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
              <p className="text-xs font-medium text-ink">No manual exchange rates recorded</p>
              <p className="mt-1 text-xs text-ink-muted">
                If you hold foreign-currency accounts or investments, add an explicit FX rate so totals convert accurately to {baseCurrency}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
              {rates.map((entry) => {
                const rowKey = entry.id || `${entry.fromCurrency}_${entry.toCurrency}_${entry.date}`;
                return (
                  <div
                    key={rowKey}
                    className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                        1 {entry.fromCurrency} = {entry.rate} {entry.toCurrency}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-muted">
                        <span className="tabular-nums">
                          Effective: {formatDisplayDate(entry.date, dateFormat)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          Created: {formatDisplayDate(entry.createdAt || entry.updatedAt, dateFormat)}
                        </span>
                        {entry.notes ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{entry.notes}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <IconButton
                        label={`Edit FX rate ${entry.fromCurrency}/${entry.toCurrency}`}
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(entry)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label={`Delete FX rate ${entry.fromCurrency}/${entry.toCurrency}`}
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDeleteRate(entry)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsItem>
      </SettingsSection>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEntry ? 'Edit Manual FX Rate' : 'Add Manual FX Rate'}
        description="Use a new Effective Date to preserve historical rates, or update an existing date directly."
      >
        <form onSubmit={(e) => void handleSaveRate(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Base Currency (From)"
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
              options={APP_CONFIG.supportedCurrencies.map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.name}`,
              }))}
            />
            <Select
              label="Quote Currency (To)"
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value)}
              options={APP_CONFIG.supportedCurrencies.map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.name}`,
              }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={`Rate (1 ${fromCurrency} in ${toCurrency})`}
              type="number"
              step="any"
              required
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              placeholder="e.g. 16200"
            />
            <Input
              label="Effective Date"
              type="date"
              required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>

          <Input
            label={`Notes (${t('common.optional')})`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Monthly closing reference rate"
          />

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {editingEntry ? t('common.saveChanges') : 'Save FX Rate'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
