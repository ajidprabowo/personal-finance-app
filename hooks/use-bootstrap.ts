'use client';

import { useSyncExternalStore } from 'react';
import { useBootstrapContext } from '@/components/providers/app-bootstrap-provider';
import {
  getPrivacyModeSnapshot,
  subscribePrivacyMode,
} from '@/lib/privacy-mode';

export function useBootstrap() {
  const context = useBootstrapContext();
  const privacyModeEnabled = useSyncExternalStore(
    subscribePrivacyMode,
    getPrivacyModeSnapshot,
    () => false
  );
  return { ...context, privacyModeEnabled };
}
