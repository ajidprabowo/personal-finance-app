import { nowIso } from '@/lib/dates';
import {
  appInstallationRepository,
  emailConnectionsRepository,
} from '@/repositories';
import type { EmailConnection, EmailConnectionStatus } from '@/types/entities';

export interface GmailSessionSnapshot {
  connection: EmailConnection | null;
  hasActiveToken: boolean;
  tokenEmailAddress: string | null;
  effectiveStatus: EmailConnectionStatus;
}

async function resolveInstallationId(): Promise<string> {
  const installation = await appInstallationRepository.getSingleton();
  return installation?.installationId ?? 'local-default-installation';
}

export async function getCurrentGmailConnection(): Promise<EmailConnection | null> {
  const installationId = await resolveInstallationId();
  const rows = await emailConnectionsRepository.getByInstallationId(installationId);
  const gmailRows = rows
    .filter((row) => row.provider === 'gmail')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return gmailRows[0] ?? null;
}

export async function recordGmailConnected(emailAddress: string): Promise<EmailConnection> {
  const cleanEmail = emailAddress.trim();
  const installationId = await resolveInstallationId();
  const existing = await getCurrentGmailConnection();

  if (existing) {
    return emailConnectionsRepository.update(existing.id, {
      emailAddress: cleanEmail,
      status: 'connected',
    });
  }

  return emailConnectionsRepository.create({
    installationId,
    provider: 'gmail',
    emailAddress: cleanEmail,
    status: 'connected',
  });
}

export async function recordGmailSyncMetadata(options: {
  emailAddress?: string;
  lastSyncedAt?: string;
  syncCursor?: string;
}): Promise<EmailConnection | null> {
  const existing = await getCurrentGmailConnection();
  const syncedAt = options.lastSyncedAt ?? nowIso();

  if (!existing) {
    if (!options.emailAddress) return null;
    const installationId = await resolveInstallationId();
    return emailConnectionsRepository.create({
      installationId,
      provider: 'gmail',
      emailAddress: options.emailAddress.trim(),
      status: 'connected',
      lastSyncedAt: syncedAt,
      syncCursor: options.syncCursor,
    });
  }

  return emailConnectionsRepository.update(existing.id, {
    emailAddress: options.emailAddress?.trim() || existing.emailAddress,
    status: 'connected',
    lastSyncedAt: syncedAt,
    syncCursor: options.syncCursor ?? existing.syncCursor,
  });
}

export async function markGmailTokenExpired(): Promise<EmailConnection | null> {
  const existing = await getCurrentGmailConnection();
  if (!existing) return null;
  if (existing.status === 'disconnected') return existing;
  return emailConnectionsRepository.update(existing.id, {
    status: 'token_expired',
  });
}

/**
 * Disconnects Gmail connection metadata locally while strictly preserving
 * all previously imported financial transactions and import history in IndexedDB.
 */
export async function disconnectGmailMetadata(): Promise<EmailConnection | null> {
  const existing = await getCurrentGmailConnection();
  if (!existing) return null;
  return emailConnectionsRepository.update(existing.id, {
    status: 'disconnected',
    syncCursor: undefined,
  });
}

export async function getGmailSessionSnapshot(): Promise<GmailSessionSnapshot> {
  const connection = await getCurrentGmailConnection();

  if (typeof window === 'undefined') {
    return {
      connection,
      hasActiveToken: false,
      tokenEmailAddress: null,
      effectiveStatus: connection?.status ?? 'disconnected',
    };
  }

  const { getInMemoryGmailSessionInfo } = await import('@/lib/gmail-auth');
  const session = getInMemoryGmailSessionInfo();

  let effectiveStatus: EmailConnectionStatus = connection?.status ?? 'disconnected';
  if (connection?.status === 'connected' && !session.hasActiveToken) {
    effectiveStatus = 'token_expired';
  } else if (session.hasActiveToken && connection?.status !== 'disconnected') {
    effectiveStatus = 'connected';
  }

  return {
    connection,
    hasActiveToken: session.hasActiveToken,
    tokenEmailAddress: session.emailAddress,
    effectiveStatus,
  };
}

export async function connectGmailAccount(): Promise<GmailSessionSnapshot> {
  if (typeof window === 'undefined') {
    throw new Error('Gmail interactive sign-in must run in the browser.');
  }
  const { connectGmailWithGooglePopup } = await import('@/lib/gmail-auth');
  const result = await connectGmailWithGooglePopup();
  const connection = await recordGmailConnected(result.emailAddress);

  return {
    connection,
    hasActiveToken: true,
    tokenEmailAddress: result.emailAddress,
    effectiveStatus: 'connected',
  };
}

export async function disconnectGmailAccount(): Promise<GmailSessionSnapshot> {
  if (typeof window !== 'undefined') {
    const { signOutAndRevokeGmailSession } = await import('@/lib/gmail-auth');
    await signOutAndRevokeGmailSession();
  }
  const connection = await disconnectGmailMetadata();
  return {
    connection,
    hasActiveToken: false,
    tokenEmailAddress: null,
    effectiveStatus: 'disconnected',
  };
}
