'use client';

import React, { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/providers/theme-provider';
import { Select } from '@/components/ui/select';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSection } from '@/components/ui/settings-section';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { THEME_OPTIONS, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { updateUserPreferences } from '@/services/settings.service';
import type {
  DateFormatPreference,
  FirstDayOfWeekPreference,
  LanguagePreference,
  NumberFormatPreference,
} from '@/types/entities';

const THEME_ICONS: Record<ThemeMode, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export interface AppearancePreferencesSectionProps {
  mode?: 'appearance' | 'preferences' | 'both';
}

export function AppearancePreferencesSection({
  mode = 'both',
}: AppearancePreferencesSectionProps) {
  const { installation, preferences, refreshBootstrap } = useBootstrap();
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { notifySuccess, notifyError } = useNotifications();
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const handleThemeSelect = async (nextTheme: ThemeMode) => {
    try {
      await setTheme(nextTheme);
      notifySuccess('Appearance updated', `Theme switched to ${nextTheme}.`);
    } catch (error) {
      notifyError('Failed to save theme preference', error);
    }
  };

  const handlePrefChange = async (
    key: string,
    patch: Parameters<typeof updateUserPreferences>[1]
  ) => {
    if (!installation?.installationId) return;
    setUpdatingKey(key);
    try {
      await updateUserPreferences(installation.installationId, patch);
      await refreshBootstrap();
      notifySuccess('Preference saved', 'Updated local application preferences.');
    } catch (error) {
      notifyError('Failed to update preference', error);
    } finally {
      setUpdatingKey(null);
    }
  };

  const showAppearance = mode === 'appearance' || mode === 'both';
  const showPreferences = mode === 'preferences' || mode === 'both';

  return (
    <div className="space-y-8">
      {showAppearance ? (
        <SettingsSection
          id="appearance"
          title={t('settings.section.appearance')}
          description="Choose how the application renders across sessions. Defaults to your system setting and applies without page flash."
        >
          <SettingsItem
            label={t('settings.appearance.theme')}
            description="Applies immediately across all pages and persists locally."
            layout="stack"
          >
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Color Theme">
              {THEME_OPTIONS.map((opt) => {
                const Icon = THEME_ICONS[opt.value];
                const isSelected = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => void handleThemeSelect(opt.value)}
                    className={cn(
                      'flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                      isSelected
                        ? 'border-brand-accent bg-brand-accent-soft'
                        : 'border-line bg-surface hover:bg-surface-muted'
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <Icon
                        className={cn(
                          'h-4 w-4',
                          isSelected ? 'text-brand-accent' : 'text-ink-muted'
                        )}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[11px] text-ink-muted">
                        {isSelected ? t('common.active') : ''}
                      </span>
                    </div>
                    <span className="mt-2.5 text-sm font-semibold text-ink">{opt.label}</span>
                    <span className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </SettingsItem>
        </SettingsSection>
      ) : null}

      {showPreferences ? (
        <SettingsSection
          id="preferences"
          title={t('settings.section.preferences')}
          description="Regional formatting, calendar week start, currency reporting, timezone, and interface language."
        >
          <SettingsItem
            label={t('settings.prefs.currency')}
            description="Primary reporting currency across Dashboard, Analytics, Budgets, and Summaries."
            control={
              <div className="w-56">
                <Select
                  aria-label="Default Currency"
                  value={preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency}
                  disabled={updatingKey === 'baseCurrency'}
                  onChange={(e) =>
                    void handlePrefChange('baseCurrency', { baseCurrency: e.target.value })
                  }
                  options={APP_CONFIG.supportedCurrencies.map((c) => ({
                    value: c.code,
                    label: `${c.code} — ${c.name}`,
                  }))}
                />
              </div>
            }
          />

          <SettingsItem
            label={t('settings.prefs.numberFormat')}
            description="Controls thousands and decimal separators across all amounts."
            control={
              <div className="w-56">
                <Select
                  aria-label="Number Format"
                  value={preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat}
                  disabled={updatingKey === 'numberFormat'}
                  onChange={(e) =>
                    void handlePrefChange('numberFormat', {
                      numberFormat: e.target.value as NumberFormatPreference,
                    })
                  }
                  options={[
                    { value: 'id-ID', label: 'Indonesian (1.250.000)' },
                    { value: 'en-US', label: 'International (1,250,000)' },
                  ]}
                />
              </div>
            }
          />

          <SettingsItem
            label={t('settings.prefs.dateFormat')}
            description="Display order for transaction, valuation, and budget dates."
            control={
              <div className="w-56">
                <Select
                  aria-label="Date Format"
                  value={preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat}
                  disabled={updatingKey === 'dateFormat'}
                  onChange={(e) =>
                    void handlePrefChange('dateFormat', {
                      dateFormat: e.target.value as DateFormatPreference,
                    })
                  }
                  options={[
                    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (24/11/2026)' },
                    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (11/24/2026)' },
                    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-11-24)' },
                    { value: 'DD MMM YYYY', label: 'DD MMM YYYY (24 Nov 2026)' },
                  ]}
                />
              </div>
            }
          />

          <SettingsItem
            label={t('settings.prefs.firstDayOfWeek')}
            description="Sets the starting weekday for weekly spending and analytics grouping."
            control={
              <div className="w-56">
                <Select
                  aria-label="First Day of Week"
                  value={preferences?.firstDayOfWeek ?? APP_CONFIG.defaultFirstDayOfWeek}
                  disabled={updatingKey === 'firstDayOfWeek'}
                  onChange={(e) =>
                    void handlePrefChange('firstDayOfWeek', {
                      firstDayOfWeek: e.target.value as FirstDayOfWeekPreference,
                    })
                  }
                  options={[
                    { value: 'monday', label: t('settings.prefs.monday') },
                    { value: 'sunday', label: t('settings.prefs.sunday') },
                  ]}
                />
              </div>
            }
          />

          <SettingsItem
            label={t('settings.prefs.language')}
            description="Preferred interface language applied across navigation and modules."
            control={
              <div className="w-56">
                <Select
                  aria-label="Language"
                  value={preferences?.language ?? APP_CONFIG.defaultLanguage}
                  disabled={updatingKey === 'language'}
                  onChange={(e) =>
                    void handlePrefChange('language', {
                      language: e.target.value as LanguagePreference,
                    })
                  }
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'id', label: 'Indonesian (Bahasa Indonesia)' },
                  ]}
                />
              </div>
            }
          />

          <SettingsItem
            label={t('settings.prefs.timezone')}
            description="Used for current-day calculation, date grouping, and backup timestamps."
            control={
              <div className="w-56">
                <Select
                  aria-label="Timezone"
                  value={preferences?.timezone ?? APP_CONFIG.defaultTimezone}
                  disabled={updatingKey === 'timezone'}
                  onChange={(e) =>
                    void handlePrefChange('timezone', { timezone: e.target.value })
                  }
                  options={APP_CONFIG.supportedTimezones.map((tz) => ({
                    value: tz.value,
                    label: tz.label,
                  }))}
                />
              </div>
            }
          />
        </SettingsSection>
      ) : null}
    </div>
  );
}
