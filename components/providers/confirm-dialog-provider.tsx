'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'default';
  details?: string[];
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [activeOptions, setActiveOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const closeWith = useCallback((result: boolean) => {
    setActiveOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(result);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    if (resolverRef.current) {
      resolverRef.current(false);
    }
    setActiveOptions(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <ConfirmationDialog
        open={Boolean(activeOptions)}
        title={activeOptions?.title ?? ''}
        description={activeOptions?.description ?? ''}
        confirmLabel={activeOptions?.confirmLabel}
        cancelLabel={activeOptions?.cancelLabel}
        tone={activeOptions?.tone}
        details={activeOptions?.details}
        onConfirm={() => closeWith(true)}
        onCancel={() => closeWith(false)}
      />
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialogContext(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error('useConfirmDialog must be used inside ConfirmDialogProvider.');
  }
  return ctx;
}
