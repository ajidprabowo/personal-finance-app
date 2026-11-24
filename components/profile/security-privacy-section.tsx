'use client';

import React from 'react';
import { AlertTriangle, FileJson, HardDrive, MailCheck, ShieldCheck } from 'lucide-react';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSection } from '@/components/ui/settings-section';
import { useI18n } from '@/hooks/use-i18n';

export function SecurityPrivacySection() {
  const { t } = useI18n();

  return (
    <SettingsSection
      id="security-privacy"
      title={t('settings.section.security')}
      description="Transparent disclosure of how your financial data is stored locally and what risks apply."
    >
      <SettingsItem
        label="Local Browser Storage"
        description="All transactions, accounts, holdings, budgets, and preferences live exclusively inside your browser's local database on this device. There is no cloud database or account login."
        control={
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink">
            <HardDrive className="h-3.5 w-3.5 text-brand-accent" aria-hidden="true" />
            <span>On-Device Only</span>
          </span>
        }
      />

      <SettingsItem
        label="Browser Data & Incognito Risk"
        description="Clearing browser site data, uninstalling your browser, or using private/incognito sessions will permanently erase your local financial records unless you keep an exported backup."
        control={
          <span className="inline-flex items-center gap-1.5 rounded border border-status-warning/30 bg-status-warning/10 px-2.5 py-1 text-xs font-medium text-status-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back Up Regularly</span>
          </span>
        }
      />

      <SettingsItem
        label="JSON Backup Confidentiality"
        description="Exported JSON backup files contain unencrypted personal financial records in plain JSON format. Store backup files in a trusted location and do not share them publicly."
        control={
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
            <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Plain JSON Export</span>
          </span>
        }
      />

      <SettingsItem
        label="Permanent Local Deletion"
        description="Using 'Clear Application Data' in Storage & Backup permanently wipes all local records and preferences and resets this browser workspace to factory defaults."
        control={
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Explicit Confirmation</span>
          </span>
        }
      />

      <SettingsItem
        label="Future Gmail Integration Architecture"
        description="When Gmail OAuth sync is introduced in a future stage, OAuth tokens will be handled securely server-side via environment-configured API routes rather than stored inside local browser financial records."
        control={
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
            <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Pending Future Stage</span>
          </span>
        }
      />
    </SettingsSection>
  );
}
