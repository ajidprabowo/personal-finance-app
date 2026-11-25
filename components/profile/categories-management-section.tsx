'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { SettingsSection } from '@/components/ui/settings-section';
import { SortableRow, reorderIds } from '@/components/shared/sortable-row';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { CATEGORY_ICON_REGISTRY, resolveCategoryIcon } from '@/lib/category-icons';
import { cn } from '@/lib/utils';
import {
  createCustomCategory,
  createUserSubcategory,
  deleteCustomCategory,
  deleteUserSubcategorySafely,
  listUserCategoriesWithCounts,
  savePriorityOrder,
  toggleCategoryArchive,
  updateUserCategory,
  updateUserSubcategory,
} from '@/services/settings.service';
import type { Category, CategoryKind, Subcategory } from '@/types/entities';

type CategoryKindFilter = 'all' | 'expense' | 'income';

export function CategoriesManagementSection() {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [subCounts, setSubCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<CategoryKindFilter>('all');
  const [showArchived, setShowArchived] = useState(true);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  // Category modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [iconKey, setIconKey] = useState<string>('tag');

  // Inline / modal subcategory editor state
  const [newSubNameByCat, setNewSubNameByCat] = useState<Record<string, string>>({});
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editingSubName, setEditingSubName] = useState('');
  const [subBusyId, setSubBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await listUserCategoriesWithCounts();
      setCategories(data.categories);
      setSubcategories(data.subcategories);
      setSubCounts(data.subcategoryCounts);
    } catch (error) {
      notifyError('Failed to load categories', error);
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    let active = true;
    listUserCategoriesWithCounts()
      .then((data) => {
        if (!active) return;
        setCategories(data.categories);
        setSubcategories(data.subcategories);
        setSubCounts(data.subcategoryCounts);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load categories', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const subcategoriesByCategory = useMemo(() => {
    const map = new Map<string, Subcategory[]>();
    for (const sub of subcategories) {
      const list = map.get(sub.categoryId) ?? [];
      list.push(sub);
      map.set(sub.categoryId, list);
    }
    return map;
  }, [subcategories]);

  const visibleCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (kindFilter !== 'all' && cat.kind !== kindFilter) return false;
      if (!showArchived && cat.isArchived) return false;
      return true;
    });
  }, [categories, kindFilter, showArchived]);

  const openAddModal = () => {
    setEditingCategory(null);
    setName('');
    setKind(kindFilter === 'income' ? 'income' : 'expense');
    setIconKey('tag');
    setModalOpen(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setName(cat.name);
    setKind(cat.kind);
    setIconKey(cat.icon || 'tag');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingCategory) {
        await updateUserCategory(editingCategory.id, { name, kind, icon: iconKey });
        notifySuccess('Category updated', `Saved changes to "${name.trim()}".`);
      } else {
        await createCustomCategory({ name, kind, icon: iconKey });
        notifySuccess('Custom category added', `Created "${name.trim()}".`);
      }
      setModalOpen(false);
      await reload();
    } catch (error) {
      notifyError('Could not save category', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async (cat: Category) => {
    try {
      const nextArchived = !cat.isArchived;
      await toggleCategoryArchive(cat.id, nextArchived);
      notifySuccess(
        nextArchived ? 'Category archived' : 'Category restored',
        nextArchived
          ? `"${cat.name}" is hidden from new forms while preserving historical records.`
          : `"${cat.name}" is active again.`
      );
      await reload();
    } catch (error) {
      notifyError('Failed to update category status', error);
    }
  };

  const handleDeleteCustom = async (cat: Category) => {
    const approved = await confirm({
      title: 'Delete Custom Category',
      description: `Delete custom category "${cat.name}" from your local categories table? If referenced by transactions or budgets, it will be archived safely instead.`,
      confirmLabel: 'Delete Category',
      tone: 'danger',
    });
    if (!approved) return;

    try {
      const result = await deleteCustomCategory(cat.id);
      if (result.archivedInstead) {
        notifySuccess(
          'Category archived',
          `"${cat.name}" has historical transactions or budgets, so it was archived to preserve data integrity.`
        );
      } else {
        notifySuccess('Category deleted', `Removed "${cat.name}".`);
      }
      await reload();
    } catch (error) {
      notifyError('Cannot delete category', error);
    }
  };

  const handleCreateSubcategory = async (categoryId: string) => {
    const draft = (newSubNameByCat[categoryId] ?? '').trim();
    if (!draft) return;
    setSubBusyId(categoryId);
    try {
      await createUserSubcategory({ categoryId, name: draft });
      setNewSubNameByCat((prev) => ({ ...prev, [categoryId]: '' }));
      notifySuccess('Subcategory added', `Added "${draft}".`);
      await reload();
    } catch (error) {
      notifyError('Could not add subcategory', error);
    } finally {
      setSubBusyId(null);
    }
  };

  const handleSaveSubcategoryEdit = async (sub: Subcategory) => {
    setSubBusyId(sub.id);
    try {
      await updateUserSubcategory(sub.id, { name: editingSubName });
      setEditingSubId(null);
      setEditingSubName('');
      notifySuccess('Subcategory updated', 'Saved subcategory label.');
      await reload();
    } catch (error) {
      notifyError('Could not update subcategory', error);
    } finally {
      setSubBusyId(null);
    }
  };

  const handleToggleSubArchive = async (sub: Subcategory) => {
    setSubBusyId(sub.id);
    try {
      await updateUserSubcategory(sub.id, {
        name: sub.name,
        isArchived: !sub.isArchived,
      });
      notifySuccess(
        !sub.isArchived ? 'Subcategory archived' : 'Subcategory restored',
        `"${sub.name}" updated.`
      );
      await reload();
    } catch (error) {
      notifyError('Could not update subcategory', error);
    } finally {
      setSubBusyId(null);
    }
  };

  const handleDeleteSubcategory = async (sub: Subcategory) => {
    const approved = await confirm({
      title: 'Delete Subcategory',
      description: `Remove subcategory "${sub.name}"? If linked to existing transactions, it will be archived instead.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!approved) return;

    setSubBusyId(sub.id);
    try {
      const result = await deleteUserSubcategorySafely(sub.id);
      if (result.archivedInstead) {
        notifySuccess(
          'Subcategory archived',
          `"${sub.name}" has linked transactions, so it was archived instead of deleted.`
        );
      } else {
        notifySuccess('Subcategory deleted', `Removed "${sub.name}".`);
      }
      await reload();
    } catch (error) {
      notifyError('Could not delete subcategory', error);
    } finally {
      setSubBusyId(null);
    }
  };

  const handleReorder = async (draggedId: string, targetId: string) => {
    try {
      const ordered = reorderIds(categories, draggedId, targetId);
      await savePriorityOrder('categories', ordered.map((category) => category.id));
      await reload();
    } catch (error) {
      notifyError('Could not save category order', error);
    }
  };

  return (
    <>
      <SettingsSection
        id="categories"
        title={t('settings.section.categories')}
        description="Manage Income & Expense categories, Lucide icons, and subcategories. Default categories cannot be deleted but can be renamed or archived."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter categories by type"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as CategoryKindFilter)}
              options={[
                { value: 'all', label: `All Types (${categories.length})` },
                {
                  value: 'expense',
                  label: `Expense (${categories.filter((c) => c.kind === 'expense').length})`,
                },
                {
                  value: 'income',
                  label: `Income (${categories.filter((c) => c.kind === 'income').length})`,
                },
              ]}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowArchived((prev) => !prev)}
            >
              {showArchived ? 'Hide Archived' : 'Show Archived'}
            </Button>
            <Button variant="outline" size="sm" onClick={openAddModal}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Category</span>
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="px-5 py-6 text-xs text-ink-muted">{t('common.loading')}</div>
        ) : visibleCategories.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-muted">
            No categories match the current filter.
          </div>
        ) : (
          visibleCategories.map((cat) => {
            const Icon = resolveCategoryIcon(cat.icon, cat.id);
            const isExpanded = expandedCategoryId === cat.id;
            const catSubs = subcategoriesByCategory.get(cat.id) ?? [];

            return (
              <SortableRow key={cat.id} id={cat.id} onMove={handleReorder} className="flex items-start gap-1">
              <div className="min-w-0 flex-1 divide-y divide-line/60">
                <div className="flex flex-col justify-between gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">{cat.name}</p>
                        {cat.isArchived ? (
                          <span className="rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-status-warning">
                            {t('common.archived')}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        <span className="capitalize">{cat.kind}</span>
                        <span aria-hidden="true">·</span>
                        <span>{cat.isDefault ? 'Default' : 'Custom'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {subCounts[cat.id] ?? 0} subcategories
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedCategoryId((prev) => (prev === cat.id ? null : cat.id))
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Subcategories</span>
                    </Button>

                    <IconButton
                      label={`Edit ${cat.name}`}
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(cat)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>

                    <IconButton
                      label={cat.isArchived ? `Restore ${cat.name}` : `Archive ${cat.name}`}
                      variant="outline"
                      size="sm"
                      onClick={() => void handleToggleArchive(cat)}
                    >
                      {cat.isArchived ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                    </IconButton>

                    {cat.isDefault ? (
                      <IconButton
                        label={`${cat.name} is a protected default category`}
                        variant="ghost"
                        size="sm"
                        disabled
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </IconButton>
                    ) : (
                      <IconButton
                        label={`Delete ${cat.name}`}
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDeleteCustom(cat)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </div>
                </div>

                {isExpanded ? (
                  <div className="bg-surface-muted/50 px-5 py-4">
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={newSubNameByCat[cat.id] ?? ''}
                          onChange={(e) =>
                            setNewSubNameByCat((prev) => ({
                              ...prev,
                              [cat.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleCreateSubcategory(cat.id);
                            }
                          }}
                          placeholder={`Add subcategory under ${cat.name}...`}
                          className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          loading={subBusyId === cat.id}
                          onClick={() => void handleCreateSubcategory(cat.id)}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Add Subcategory</span>
                        </Button>
                      </div>

                      {catSubs.length === 0 ? (
                        <p className="text-xs text-ink-muted">
                          No subcategories added under {cat.name} yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-line rounded-lg border border-line bg-surface">
                          {catSubs.map((sub) => {
                            const isEditing = editingSubId === sub.id;
                            return (
                              <div
                                key={sub.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                              >
                                {isEditing ? (
                                  <div className="flex flex-1 items-center gap-2">
                                    <input
                                      type="text"
                                      value={editingSubName}
                                      onChange={(e) => setEditingSubName(e.target.value)}
                                      className="h-8 flex-1 rounded border border-line bg-surface px-2.5 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                                    />
                                    <Button
                                      size="sm"
                                      loading={subBusyId === sub.id}
                                      onClick={() => void handleSaveSubcategoryEdit(sub)}
                                    >
                                      {t('common.save')}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setEditingSubId(null);
                                        setEditingSubName('');
                                      }}
                                    >
                                      {t('common.cancel')}
                                    </Button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-ink">
                                        {sub.name}
                                      </span>
                                      {sub.isArchived ? (
                                        <span className="rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warning">
                                          {t('common.archived')}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <IconButton
                                        label={`Edit ${sub.name}`}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setEditingSubId(sub.id);
                                          setEditingSubName(sub.name);
                                        }}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </IconButton>
                                      <IconButton
                                        label={
                                          sub.isArchived
                                            ? `Restore ${sub.name}`
                                            : `Archive ${sub.name}`
                                        }
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void handleToggleSubArchive(sub)}
                                      >
                                        {sub.isArchived ? (
                                          <RotateCcw className="h-3 w-3" />
                                        ) : (
                                          <Archive className="h-3 w-3" />
                                        )}
                                      </IconButton>
                                      <IconButton
                                        label={`Delete ${sub.name}`}
                                        variant="danger"
                                        size="sm"
                                        onClick={() => void handleDeleteSubcategory(sub)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </IconButton>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
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
        title={editingCategory ? 'Edit Category' : 'Add Custom Category'}
        description="Only Income and Expense categories are managed here. Transfers are handled as account-to-account movements."
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Input
            label="Category Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Healthcare"
          />

          <Select
            label="Category Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CategoryKind)}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />

          <div className="space-y-2">
            <p className="text-xs font-medium text-ink">Category Icon</p>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">
              {CATEGORY_ICON_REGISTRY.map((meta) => {
                const IconComp = meta.icon;
                const selected = iconKey === meta.key;
                return (
                  <button
                    key={meta.key}
                    type="button"
                    title={meta.label}
                    aria-label={meta.label}
                    aria-pressed={selected}
                    onClick={() => setIconKey(meta.key)}
                    className={cn(
                      'flex h-10 items-center justify-center rounded-lg border transition-colors',
                      selected
                        ? 'border-brand-accent bg-brand-accent-soft text-brand-accent'
                        : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
                    )}
                  >
                    <IconComp className="h-4 w-4" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {editingCategory ? t('common.saveChanges') : 'Create Category'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
