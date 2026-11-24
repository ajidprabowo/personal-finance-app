'use client';

import React, { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Coins,
  Database,
  FolderKanban,
  Info,
  Landmark,
  Layers,
  LayoutGrid,
  Mail,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { AccountsManagementSection } from '@/components/profile/accounts-management-section';
import { AppearancePreferencesSection } from '@/components/profile/appearance-preferences-section';
import { AssetClassesManagementSection } from '@/components/profile/asset-classes-management-section';
import { CategoriesManagementSection } from '@/components/profile/categories-management-section';
import { CurrencyFxSection } from '@/components/profile/currency-fx-section';
import { PersonalInfoSection } from '@/components/profile/personal-info-section';
import { PlatformsManagementSection } from '@/components/profile/platforms-management-section';
import { SecurityPrivacySection } from '@/components/profile/security-privacy-section';
import {
  AboutAppSection,
  EmailIntegrationSection,
  StorageBackupSection,
} from '@/components/profile/storage-email-about-sections';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useI18n } from '@/hooks/use-i18n';
import type { I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type SettingsSectionKey =
  | 'all'
  | 'personal'
  | 'security'
  | 'appearance'
  | 'preferences'
  | 'accounts'
  | 'categories'
  | 'platforms'
  | 'assetClasses'
  | 'currencyFx'
  | 'email'
  | 'storage'
  | 'about';

interface NavSectionItem {
  key: Exclude<SettingsSectionKey, 'all'>;
  labelKey: I18nKey;
  anchor: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  groupKey: I18nKey;
  items: NavSectionItem[];
}

const SETTINGS_NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'settings.group.identity',
    items: [
      { key: 'personal', labelKey: 'settings.section.personal', anchor: 'personal-info', icon: User },
      {
        key: 'security',
        labelKey: 'settings.section.security',
        anchor: 'security-privacy',
        icon: ShieldCheck,
      },
    ],
  },
  {
    groupKey: 'settings.group.regional',
    items: [
      {
        key: 'appearance',
        labelKey: 'settings.section.appearance',
        anchor: 'appearance',
        icon: Palette,
      },
      {
        key: 'preferences',
        labelKey: 'settings.section.preferences',
        anchor: 'preferences',
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    groupKey: 'settings.group.taxonomy',
    items: [
      { key: 'accounts', labelKey: 'settings.section.accounts', anchor: 'accounts', icon: Landmark },
      {
        key: 'categories',
        labelKey: 'settings.section.categories',
        anchor: 'categories',
        icon: FolderKanban,
      },
      {
        key: 'platforms',
        labelKey: 'settings.section.platforms',
        anchor: 'platforms',
        icon: Layers,
      },
      {
        key: 'assetClasses',
        labelKey: 'settings.section.assetClasses',
        anchor: 'asset-classes',
        icon: LayoutGrid,
      },
      {
        key: 'currencyFx',
        labelKey: 'settings.section.currencyFx',
        anchor: 'currency-fx',
        icon: Coins,
      },
    ],
  },
  {
    groupKey: 'settings.group.data',
    items: [
      {
        key: 'email',
        labelKey: 'settings.section.email',
        anchor: 'email-integration',
        icon: Mail,
      },
      {
        key: 'storage',
        labelKey: 'settings.section.storage',
        anchor: 'storage-backup',
        icon: Database,
      },
      { key: 'about', labelKey: 'settings.section.about', anchor: 'about', icon: Info },
    ],
  },
];

const ALL_ITEMS = SETTINGS_NAV_GROUPS.flatMap((g) => g.items);

const URL_CHANGE_EVENT = 'pfa-settings-url-change';

function subscribeUrlLocation(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('popstate', callback);
  window.addEventListener('hashchange', callback);
  window.addEventListener(URL_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener('hashchange', callback);
    window.removeEventListener(URL_CHANGE_EVENT, callback);
  };
}

function getClientUrlSnapshot(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.search}|${window.location.hash}`;
}

function getServerUrlSnapshot(): string {
  return '';
}

function resolveSectionFromSnapshot(snapshot: string): SettingsSectionKey {
  if (!snapshot) return 'all';
  const [search = '', hashRaw = ''] = snapshot.split('|');
  const params = new URLSearchParams(search);
  const querySection = params.get('section');
  const hash = hashRaw.replace(/^#/, '');

  const matchByKey = ALL_ITEMS.find((item) => item.key === querySection);
  if (matchByKey) return matchByKey.key;

  const matchByAnchor = ALL_ITEMS.find((item) => item.anchor === hash || item.key === hash);
  if (matchByAnchor) return matchByAnchor.key;

  return 'all';
}

export function ProfileSettingsView() {
  const { t } = useI18n();
  const urlSnapshot = useSyncExternalStore(
    subscribeUrlLocation,
    getClientUrlSnapshot,
    getServerUrlSnapshot
  );
  const activeSection = resolveSectionFromSnapshot(urlSnapshot);

  const handleSelectSection = (nextKey: SettingsSectionKey) => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (nextKey === 'all') {
        url.searchParams.delete('section');
        url.hash = '';
      } else {
        url.searchParams.set('section', nextKey);
        url.hash = '';
      }
      window.history.replaceState(null, '', url.toString());
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const mobileSelectOptions = useMemo(() => {
    return [
      { value: 'all', label: t('settings.viewAll') },
      ...ALL_ITEMS.map((item) => ({
        value: item.key,
        label: t(item.labelKey),
      })),
    ];
  }, [t]);

  const showSection = (key: Exclude<SettingsSectionKey, 'all'>): boolean =>
    activeSection === 'all' || activeSection === key;

  return (
    <AppLayout>
      <PageContainer maxWidth="wide">
        <PageHeader
          title={t('page.profile.title')}
          description={t('page.profile.description')}
          action={
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('nav.backToDashboard')}</span>
              </Button>
            </Link>
          }
        />

        {/* Mobile Section Selector */}
        <div className="mb-6 lg:hidden">
          <Select
            label="Settings Section"
            aria-label="Select settings section"
            value={activeSection}
            onChange={(e) => handleSelectSection(e.target.value as SettingsSectionKey)}
            options={mobileSelectOptions}
          />
        </div>

        <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start lg:gap-8">
          {/* Desktop Categorized Sidebar */}
          <aside className="hidden lg:sticky lg:top-20 lg:block">
            <nav
              aria-label="Profile & Settings Sections"
              className="space-y-5 rounded-xl border border-line bg-surface p-3"
            >
              <button
                type="button"
                onClick={() => handleSelectSection('all')}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors',
                  activeSection === 'all'
                    ? 'bg-brand-accent-soft text-brand-accent'
                    : 'text-ink hover:bg-surface-muted'
                )}
              >
                <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t('settings.viewAll')}</span>
              </button>

              {SETTINGS_NAV_GROUPS.map((group) => (
                <div key={group.groupKey} className="space-y-1">
                  <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    {t(group.groupKey)}
                  </p>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleSelectSection(item.key)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors',
                          isActive
                            ? 'bg-brand-accent-soft text-brand-accent'
                            : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>

          {/* Active Sections Content */}
          <div className="min-w-0 space-y-8">
            {showSection('personal') ? <PersonalInfoSection /> : null}
            {showSection('security') ? <SecurityPrivacySection /> : null}
            {activeSection === 'all' ? (
              <AppearancePreferencesSection mode="both" />
            ) : activeSection === 'appearance' ? (
              <AppearancePreferencesSection mode="appearance" />
            ) : activeSection === 'preferences' ? (
              <AppearancePreferencesSection mode="preferences" />
            ) : null}
            {showSection('accounts') ? <AccountsManagementSection /> : null}
            {showSection('categories') ? <CategoriesManagementSection /> : null}
            {showSection('platforms') ? <PlatformsManagementSection /> : null}
            {showSection('assetClasses') ? <AssetClassesManagementSection /> : null}
            {showSection('currencyFx') ? <CurrencyFxSection /> : null}
            {showSection('email') ? <EmailIntegrationSection /> : null}
            {showSection('storage') ? <StorageBackupSection /> : null}
            {showSection('about') ? <AboutAppSection /> : null}
          </div>
        </div>
      </PageContainer>
    </AppLayout>
  );
}
