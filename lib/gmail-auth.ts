'use client';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function beginGmailOAuth(): void {
  window.location.assign('/api/gmail/connect');
}

export async function signOutAndRevokeGmailSession(): Promise<{ revoked: boolean }> {
  const response = await fetch('/api/gmail/disconnect', {
    method: 'POST',
    cache: 'no-store',
  });
  const result = (await response.json().catch(() => null)) as
    | { revoked?: boolean }
    | null;
  return { revoked: Boolean(response.ok && result?.revoked) };
}
