'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useNotifications } from '@/hooks/use-notifications';

export function PrivacyModeToggle({ dark = false }: { dark?: boolean }) {
  const { installation, privacyModeEnabled, setPrivacyModeEnabled } = useBootstrap();
  const { notifyError } = useNotifications();
  const label = privacyModeEnabled ? 'Show Values' : 'Hide Values';

  const handleToggle = async () => {
    try {
      await setPrivacyModeEnabled(!privacyModeEnabled);
    } catch (error) {
      notifyError('Privacy setting could not be saved', error);
    }
  };

  const Icon = privacyModeEnabled ? EyeOff : Eye;

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      disabled={!installation}
      aria-label={label}
      aria-pressed={privacyModeEnabled}
      title={label}
      className={
        dark
          ? 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50'
          : 'inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-muted/70 text-ink transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-50'
      }
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
