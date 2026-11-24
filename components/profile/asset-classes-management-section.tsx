'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { SettingsSection } from '@/components/ui/settings-section';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import {
  createAssetClass,
  deleteAssetClassSafely,
  listAssetClassesWithUsage,
  toggleAssetClassEnabled,
  updateAssetClass,
  type AssetClassWithUsage,
} from '@/services/asset-class.service';
import type { AssetClass } from '@/types/entities';

export function AssetClassesManagementSection() {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const [items, setItems] = useState<AssetClassWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingClass, setEditingClass] = useState<AssetClass | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');

  const reload = useCallback(async () => {
    try {
      const rows = await listAssetClassesWithUsage({ recordOrigin: 'user' });
      setItems(rows);
    } catch (error) {
      notifyError('Failed to load asset classes', error);
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    let active = true;
    listAssetClassesWithUsage({ recordOrigin: 'user' })
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load asset classes', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const openAddModal = () => {
    setEditingClass(null);
    setName('');
    setCode('');
    setDescription('');
    setModalOpen(true);
  };

  const openEditModal = (assetClass: AssetClass) => {
    setEditingClass(assetClass);
    setName(assetClass.name);
    setCode(assetClass.code);
    setDescription(assetClass.description ?? '');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingClass) {
        await updateAssetClass(editingClass.id, {
          name,
          description,
        });
        notifySuccess('Asset class updated', `Saved changes to "${name.trim()}".`);
      } else {
        await createAssetClass({
          name,
          code: code || undefined,
          description,
        });
        notifySuccess('Asset class added', `Created "${name.trim()}".`);
      }
      setModalOpen(false);
      await reload();
    } catch (error) {
      notifyError('Could not save asset class', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (assetClass: AssetClass) => {
    try {
      const nextEnabled = Boolean(assetClass.isArchived);
      await toggleAssetClassEnabled(assetClass.id, nextEnabled);
      notifySuccess(
        nextEnabled ? 'Asset class enabled' : 'Asset class disabled',
        `"${assetClass.name}" is now ${nextEnabled ? 'enabled' : 'disabled'}.`
      );
      await reload();
    } catch (error) {
      notifyError('Failed to update asset class status', error);
    }
  };

  const handleDelete = async (item: AssetClassWithUsage) => {
    const ac = item.assetClass;
    const approved = await confirm({
      title: 'Delete Asset Class',
      description: `Permanently delete custom asset class "${ac.name}"?`,
      confirmLabel: 'Delete Asset Class',
      tone: 'danger',
    });
    if (!approved) return;

    try {
      await deleteAssetClassSafely(ac.id);
      notifySuccess('Asset class deleted', `Removed "${ac.name}".`);
      await reload();
    } catch (error) {
      notifyError('Cannot delete asset class', error);
    }
  };

  return (
    <>
      <SettingsSection
        id="asset-classes"
        title={t('settings.section.assetClasses')}
        description="Configure investment asset classes used across portfolio allocation, Investments, and Analytics."
        action={
          <Button variant="outline" size="sm" onClick={openAddModal}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Asset Class</span>
          </Button>
        }
      >
        {loading ? (
          <div className="px-5 py-6 text-xs text-ink-muted">{t('common.loading')}</div>
        ) : (
          items.map((item) => {
            const ac = item.assetClass;
            return (
              <div
                key={ac.id}
                className="flex flex-col justify-between gap-3 px-5 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">{ac.name}</p>
                    <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                      {ac.code}
                    </span>
                    <span
                      className={
                        ac.isArchived
                          ? 'rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-status-warning'
                          : 'rounded border border-status-success/30 bg-status-success/10 px-1.5 py-0.5 text-[11px] font-medium text-status-success'
                      }
                    >
                      {ac.isArchived ? t('common.disabled') : t('common.enabled')}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>{ac.isDefault ? 'Default' : 'Custom'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{item.holdingCount} holding(s)</span>
                    {ac.description ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{ac.description}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant={ac.isArchived ? 'outline' : 'secondary'}
                    size="sm"
                    onClick={() => void handleToggleEnabled(ac)}
                  >
                    {ac.isArchived ? t('common.enable') : t('common.disable')}
                  </Button>
                  <IconButton
                    label={`Edit ${ac.name}`}
                    variant="outline"
                    size="sm"
                    onClick={() => openEditModal(ac)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  {ac.isDefault ? (
                    <IconButton
                      label={`${ac.name} is a protected default asset class`}
                      variant="ghost"
                      size="sm"
                      disabled
                    >
                      <Lock className="h-3.5 w-3.5" />
                    </IconButton>
                  ) : (
                    <IconButton
                      label={`Delete ${ac.name}`}
                      variant="danger"
                      size="sm"
                      onClick={() => void handleDelete(item)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingClass ? 'Edit Asset Class' : 'Add Custom Asset Class'}
        description="Asset classes categorize holdings across Investments and Portfolio Analytics."
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Input
            label="Asset Class Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Precious Metals"
          />

          {!editingClass ? (
            <Input
              label={`Code (${t('common.optional')})`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. GOLD"
              helperText="Auto-generated from name if left blank."
            />
          ) : null}

          <Input
            label={`Description (${t('common.optional')})`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Physical gold and gold-backed instruments"
          />

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {editingClass ? t('common.saveChanges') : 'Create Asset Class'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
