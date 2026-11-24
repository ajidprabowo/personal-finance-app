'use client';

import React, { useState } from 'react';
import { Pencil, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ProfileAvatar } from '@/components/ui/profile-avatar';
import { SettingsItem } from '@/components/ui/settings-item';
import { SettingsSection } from '@/components/ui/settings-section';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { updateUserProfile } from '@/services/settings.service';

async function resizeImageToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image file.'));
      el.src = objectUrl;
    });

    const maxSize = 160;
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function PersonalInfoSection() {
  const { installation, preferences, refreshBootstrap } = useBootstrap();
  const { t } = useI18n();
  const { notifySuccess, notifyError } = useNotifications();

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const openEditor = () => {
    setFullName(preferences?.profileName ?? '');
    setEmail(preferences?.profileEmail ?? '');
    setDescription(preferences?.profileDescription ?? '');
    setAvatarUrl(preferences?.profileAvatar ?? '');
    setModalOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setAvatarUrl(dataUrl);
    } catch (error) {
      notifyError('Could not load photo', error);
    }
  };

  const handleResetAvatarQuick = async () => {
    if (!installation?.installationId || !preferences?.profileAvatar) return;
    try {
      await updateUserProfile(installation.installationId, {
        profileName: preferences.profileName ?? '',
        profileEmail: preferences.profileEmail ?? '',
        profileAvatar: '',
        profileDescription: preferences.profileDescription ?? '',
      });
      await refreshBootstrap();
      notifySuccess('Avatar reset', 'Profile picture removed locally.');
    } catch (error) {
      notifyError('Failed to reset avatar', error);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installation?.installationId) return;

    setSaving(true);
    try {
      await updateUserProfile(installation.installationId, {
        profileName: fullName,
        profileEmail: email,
        profileAvatar: avatarUrl,
        profileDescription: description,
      });
      await refreshBootstrap();
      setModalOpen(false);
      notifySuccess('Profile updated', 'Personal information saved locally.');
    } catch (error) {
      notifyError('Failed to save profile', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsSection
        id="personal-info"
        title={t('settings.section.personal')}
        description="Stored locally on this device. Your email here is optional profile metadata and is not connected to Gmail."
        action={
          <Button variant="outline" size="sm" onClick={openEditor}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('settings.personal.edit')}</span>
          </Button>
        }
      >
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <ProfileAvatar
              name={preferences?.profileName}
              avatarUrl={preferences?.profileAvatar}
              size="lg"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-base font-semibold text-ink">
                {preferences?.profileName?.trim() || 'Name not set'}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {preferences?.profileEmail?.trim() || 'No email address added (optional)'}
              </p>
              {preferences?.profileDescription?.trim() ? (
                <p className="line-clamp-2 text-xs text-ink-muted">
                  {preferences.profileDescription.trim()}
                </p>
              ) : null}
            </div>
          </div>

          {preferences?.profileAvatar ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleResetAvatarQuick()}
              className="self-start sm:self-center"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('settings.personal.resetAvatar')}</span>
            </Button>
          ) : null}
        </div>

        <SettingsItem
          label={t('settings.personal.fullName')}
          description="Used for personalized header and dashboard greetings."
          control={
            <span className="text-sm font-medium text-ink">
              {preferences?.profileName?.trim() || '—'}
            </span>
          }
        />

        <SettingsItem
          label={t('settings.personal.email')}
          description="Optional local contact label (independent of Gmail OAuth integration)."
          control={
            <span className="font-mono text-xs text-ink-muted">
              {preferences?.profileEmail?.trim() || 'Not provided'}
            </span>
          }
        />

        <SettingsItem
          label={t('settings.personal.bio')}
          description="Optional note about this local workspace or financial household."
          control={
            <span className="max-w-xs truncate text-xs text-ink-muted">
              {preferences?.profileDescription?.trim() || '—'}
            </span>
          }
        />
      </SettingsSection>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Edit Personal Information"
        description="Profile details are stored exclusively in your browser local storage."
      >
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="flex items-center gap-4">
            <ProfileAvatar name={fullName} avatarUrl={avatarUrl} size="lg" />
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="profile-avatar-upload"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('settings.personal.uploadAvatar')}</span>
              </label>
              <input
                id="profile-avatar-upload"
                type="file"
                accept="image/*"
                onChange={(e) => void handlePhotoUpload(e)}
                className="hidden"
              />
              {avatarUrl ? (
                <Button variant="ghost" size="sm" onClick={() => setAvatarUrl('')}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('settings.personal.resetAvatar')}</span>
                </Button>
              ) : null}
            </div>
          </div>

          <Input
            label={t('settings.personal.fullName')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Budi Santoso"
          />

          <Input
            label={`${t('settings.personal.email')} (${t('common.optional')})`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            helperText="Stored locally only. Validated for format; does not connect or authenticate Gmail."
          />

          <div className="space-y-1.5">
            <label
              htmlFor="profile-description-input"
              className="block text-xs font-medium text-ink"
            >
              {t('settings.personal.bio')} ({t('common.optional')})
            </label>
            <textarea
              id="profile-description-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Personal & household finance ledger"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {t('common.saveChanges')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
