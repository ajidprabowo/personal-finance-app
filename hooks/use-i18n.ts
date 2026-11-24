'use client';

import { useCallback } from 'react';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { APP_CONFIG } from '@/lib/config';
import type { ReportingPeriodPreset } from '@/lib/dates';
import { getPeriodLabel, translate, type I18nKey } from '@/lib/i18n';
import type { LanguagePreference } from '@/types/entities';

export function useI18n() {
  const { preferences } = useBootstrap();
  const language: LanguagePreference =
    preferences?.language === 'id' ? 'id' : APP_CONFIG.defaultLanguage;

  const t = useCallback(
    (key: I18nKey): string => translate(language, key),
    [language]
  );

  const periodLabel = useCallback(
    (preset: ReportingPeriodPreset): string => getPeriodLabel(preset, language),
    [language]
  );

  return { language, t, periodLabel };
}
