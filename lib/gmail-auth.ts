'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '@/firebase-applet-config.json';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Access token lives strictly in JS memory for the active tab session.
// Never written to localStorage, sessionStorage, cookies, or IndexedDB.
let memoryAccessToken: string | null = null;
let memoryTokenEmail: string | null = null;
let memoryTokenExpiresAtMs: number | null = null;

function getFirebaseAppInstance(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
}

function getFirebaseAuthInstance(): Auth {
  return getAuth(getFirebaseAppInstance());
}

export function getInMemoryGmailAccessToken(): string | null {
  if (!memoryAccessToken) return null;
  if (memoryTokenExpiresAtMs !== null && Date.now() >= memoryTokenExpiresAtMs) {
    clearInMemoryGmailToken();
    return null;
  }
  return memoryAccessToken;
}

export function getInMemoryGmailSessionInfo(): {
  hasActiveToken: boolean;
  emailAddress: string | null;
  expiresAtMs: number | null;
} {
  const token = getInMemoryGmailAccessToken();
  return {
    hasActiveToken: Boolean(token),
    emailAddress: token ? memoryTokenEmail : null,
    expiresAtMs: token ? memoryTokenExpiresAtMs : null,
  };
}

export function clearInMemoryGmailToken(): void {
  memoryAccessToken = null;
  memoryTokenEmail = null;
  memoryTokenExpiresAtMs = null;
}

export function subscribeGmailAuthUser(
  callback: (user: User | null) => void
): () => void {
  const auth = getFirebaseAuthInstance();
  return onAuthStateChanged(auth, callback);
}

export interface GmailConnectPopupResult {
  emailAddress: string;
  accessToken: string;
}

export async function connectGmailWithGooglePopup(): Promise<GmailConnectPopupResult> {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_READONLY_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent select_account',
  });

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken ?? null;

    if (!accessToken) {
      throw new Error(
        'Google sign-in completed, but Gmail read-only access permission was not granted.'
      );
    }

    // Verify exact connected email from server-side Gmail profile route
    const profileRes = await fetch('/api/gmail/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    const profileJson = (await profileRes.json().catch(() => null)) as
      | { emailAddress?: string; error?: string }
      | null;

    if (!profileRes.ok || !profileJson?.emailAddress) {
      throw new Error(
        profileJson?.error ||
          'Connected Google account could not verify Gmail read-only access.'
      );
    }

    memoryAccessToken = accessToken;
    memoryTokenEmail = profileJson.emailAddress;
    // Standard Google OAuth access token TTL (~55m conservative window in memory)
    memoryTokenExpiresAtMs = Date.now() + 55 * 60 * 1000;

    return {
      emailAddress: profileJson.emailAddress,
      accessToken,
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';

    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Gmail authorization popup was closed before completing sign-in.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Browser blocked the Google sign-in popup. Please allow popups for this site and try again.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'This preview domain is not authorized for Google Sign-In in Firebase Authentication settings.'
      );
    }
    throw error;
  }
}

export async function signOutAndRevokeGmailSession(): Promise<{ revoked: boolean }> {
  const token = getInMemoryGmailAccessToken();
  clearInMemoryGmailToken();

  let revoked = false;
  if (token) {
    try {
      const res = await fetch('/api/gmail/disconnect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as { revoked?: boolean } | null;
      revoked = Boolean(res.ok && data?.revoked);
    } catch {
      revoked = false;
    }
  }

  try {
    const auth = getFirebaseAuthInstance();
    await signOut(auth);
  } catch {
    // Ignore Firebase sign-out edge errors after clearing local memory token
  }

  return { revoked };
}
