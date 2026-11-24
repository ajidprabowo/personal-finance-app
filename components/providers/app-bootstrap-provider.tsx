'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { normalizeErrorMessage } from '@/lib/errors';
import { initializeApplication } from '@/services/bootstrap.service';
import type { AppInstallation, UserPreferences } from '@/types/entities';

export type BootstrapStatus = 'loading' | 'ready' | 'error';

interface BootstrapContextValue {
  status: BootstrapStatus;
  installation: AppInstallation | null;
  preferences: UserPreferences | null;
  schemaVersion: number;
  isFirstLaunch: boolean;
  errorMessage: string | null;
  refreshBootstrap: () => Promise<void>;
}

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export function AppBootstrapProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<BootstrapStatus>('loading');
  const [installation, setInstallation] = useState<AppInstallation | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<number>(0);
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runInit = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setStatus('loading');
      setErrorMessage(null);
    }
    try {
      const result = await initializeApplication();
      setInstallation(result.installation);
      setPreferences(result.preferences);
      setSchemaVersion(result.schemaVersion);
      setIsFirstLaunch(result.isFirstLaunch);
      setErrorMessage(null);
      setStatus('ready');
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let active = true;
    initializeApplication()
      .then((result) => {
        if (!active) return;
        setInstallation(result.installation);
        setPreferences(result.preferences);
        setSchemaVersion(result.schemaVersion);
        setIsFirstLaunch(result.isFirstLaunch);
        setErrorMessage(null);
        setStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setErrorMessage(normalizeErrorMessage(error));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      status,
      installation,
      preferences,
      schemaVersion,
      isFirstLaunch,
      errorMessage,
      refreshBootstrap: runInit,
    }),
    [status, installation, preferences, schemaVersion, isFirstLaunch, errorMessage, runInit]
  );

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                Local Database Initialization Failed
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {errorMessage ?? 'Unable to open IndexedDB storage in this browser.'}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Verify that browser storage / IndexedDB is enabled and not blocked by private browsing restrictions.
              </p>
              <button
                type="button"
                onClick={() => void runInit()}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" />
                Retry Initialization
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}

export function useBootstrapContext(): BootstrapContextValue {
  const ctx = useContext(BootstrapContext);
  if (!ctx) {
    throw new Error('useBootstrap must be used inside AppBootstrapProvider.');
  }
  return ctx;
}
