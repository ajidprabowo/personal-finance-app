'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { normalizeErrorMessage } from '@/lib/errors';

export type NotificationTone = 'success' | 'error' | 'warning' | 'info';

export interface NotificationItem {
  id: string;
  tone: NotificationTone;
  title: string;
  message?: string;
}

interface NotificationContextValue {
  notify: (input: Omit<NotificationItem, 'id'>) => void;
  notifySuccess: (title: string, message?: string) => void;
  notifyError: (title: string, error?: unknown) => void;
  notifyWarning: (title: string, message?: string) => void;
  notifyInfo: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const TONE_STYLES: Record<NotificationTone, { container: string; icon: React.ReactNode }> = {
  success: {
    container: 'border-status-success/30 bg-surface text-ink',
    icon: <CheckCircle2 className="h-4 w-4 text-status-success shrink-0" />,
  },
  error: {
    container: 'border-status-danger/30 bg-surface text-ink',
    icon: <AlertCircle className="h-4 w-4 text-status-danger shrink-0" />,
  },
  warning: {
    container: 'border-status-warning/30 bg-surface text-ink',
    icon: <AlertTriangle className="h-4 w-4 text-status-warning shrink-0" />,
  },
  info: {
    container: 'border-line bg-surface text-ink',
    icon: <Info className="h-4 w-4 text-ink-muted shrink-0" />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((input: Omit<NotificationItem, 'id'>) => {
    const id = crypto.randomUUID();
    setItems((prev) => [...prev.slice(-4), { ...input, id }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const notifySuccess = useCallback(
    (title: string, message?: string) => notify({ tone: 'success', title, message }),
    [notify]
  );

  const notifyError = useCallback(
    (title: string, error?: unknown) => {
      const message = error !== undefined ? normalizeErrorMessage(error) : undefined;
      notify({ tone: 'error', title, message });
    },
    [notify]
  );

  const notifyWarning = useCallback(
    (title: string, message?: string) => notify({ tone: 'warning', title, message }),
    [notify]
  );

  const notifyInfo = useCallback(
    (title: string, message?: string) => notify({ tone: 'info', title, message }),
    [notify]
  );

  const value = useMemo(
    () => ({ notify, notifySuccess, notifyError, notifyWarning, notifyInfo, dismiss }),
    [notify, notifySuccess, notifyError, notifyWarning, notifyInfo, dismiss]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:bottom-24 sm:px-0"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const style = TONE_STYLES[item.tone];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-md ${style.container}`}
                role="status"
              >
                <div className="mt-0.5">{style.icon}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{item.title}</p>
                  {item.message ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{item.message}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="Dismiss notification"
                  className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotificationContext(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used inside ToastProvider.');
  }
  return ctx;
}
