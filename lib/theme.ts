export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeTokenPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceMuted: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
}

/**
 * Centralized theme configuration mapped to CSS custom properties in app/globals.css.
 */
export const THEME_TOKENS: Record<'light' | 'dark', ThemeTokenPalette> = {
  light: {
    primary: '#0F2942',
    secondary: '#4A6FA5',
    accent: '#0D9488',
    background: '#F4F6F8',
    surface: '#FFFFFF',
    surfaceMuted: '#F8FAFC',
    textPrimary: '#111827',
    textSecondary: '#64748B',
    border: '#E2E8F0',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
  dark: {
    primary: '#3B82F6',
    secondary: '#60A5FA',
    accent: '#2DD4BF',
    background: '#0B111A',
    surface: '#111927',
    surfaceMuted: '#162133',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    border: '#1E293B',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#EF4444',
  },
};

export const THEME_OPTIONS: { value: ThemeMode; label: string; description: string }[] = [
  {
    value: 'light',
    label: 'Light Mode',
    description: 'Clean daylight palette with crisp white surfaces.',
  },
  {
    value: 'dark',
    label: 'Dark Mode',
    description: 'Low-glare deep navy slate surfaces for evening sessions.',
  },
  {
    value: 'system',
    label: 'System Default',
    description: 'Automatically matches your operating system appearance.',
  },
];
