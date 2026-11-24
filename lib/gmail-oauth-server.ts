import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const GMAIL_SESSION_COOKIE = 'gmail_oauth_session';
export const GMAIL_STATE_COOKIE = 'gmail_oauth_state';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const SESSION_MAX_AGE = 60 * 60 * 24 * 180;
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

interface GmailSession {
  refreshToken: string;
  emailAddress: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function oauthClient() {
  return {
    clientId: requiredEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_CLIENT_SECRET'),
  };
}

function redirectUri(): string {
  const uri = new URL(requiredEnv('GMAIL_OAUTH_REDIRECT_URI'));
  if (uri.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('GMAIL_OAUTH_REDIRECT_URI must use HTTPS in production.');
  }
  return uri.toString();
}

export function gmailImportReturnUrl(status: 'connected' | 'error'): URL {
  const base = new URL(redirectUri());
  return new URL(`/transactions/import?gmail=${status}`, base.origin);
}

function encryptionKey(): Buffer {
  const key = Buffer.from(requiredEnv('GMAIL_TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function encryptSession(session: GmailSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptSession(value: string): GmailSession | null {
  try {
    const packed = Buffer.from(value, 'base64url');
    if (packed.length <= 28) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const plain = Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plain) as Partial<GmailSession>;
    if (typeof parsed.refreshToken !== 'string' || typeof parsed.emailAddress !== 'string') {
      return null;
    }
    return { refreshToken: parsed.refreshToken, emailAddress: parsed.emailAddress };
  } catch {
    return null;
  }
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const { clientId } = oauthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export function setOAuthStateCookie(response: NextResponse, state: string): void {
  response.cookies.set(GMAIL_STATE_COOKIE, state, cookieOptions(600));
}

export function validateOAuthState(request: NextRequest, returnedState: string | null): boolean {
  const savedState = request.cookies.get(GMAIL_STATE_COOKIE)?.value;
  if (!savedState || !returnedState) return false;
  const left = Buffer.from(savedState);
  const right = Buffer.from(returnedState);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function setGmailSessionCookie(response: NextResponse, session: GmailSession): void {
  response.cookies.set(GMAIL_SESSION_COOKIE, encryptSession(session), cookieOptions(SESSION_MAX_AGE));
}

export function clearGmailSessionCookie(response: NextResponse): void {
  response.cookies.set(GMAIL_SESSION_COOKIE, '', cookieOptions(0));
}

export function clearOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(GMAIL_STATE_COOKIE, '', cookieOptions(0));
}

export function getGmailSession(request: NextRequest): GmailSession | null {
  const value = request.cookies.get(GMAIL_SESSION_COOKIE)?.value;
  return value ? decryptSession(value) : null;
}

async function postTokenRequest(params: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Google OAuth token request failed.');
  }
  return data;
}

export async function exchangeAuthorizationCode(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = oauthClient();
  return postTokenRequest(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    })
  );
}

export async function refreshGmailAccessToken(session: GmailSession): Promise<string> {
  const { clientId, clientSecret } = oauthClient();
  const data = await postTokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    })
  );
  if (!data.access_token) throw new Error('Google did not return an access token.');
  return data.access_token;
}

export async function verifyGrantedGmailScope(accessToken: string): Promise<boolean> {
  const response = await fetch(
    `${GOOGLE_TOKEN_INFO_URL}?${new URLSearchParams({ access_token: accessToken })}`,
    { cache: 'no-store' }
  );
  if (!response.ok) return false;
  const info = (await response.json().catch(() => ({}))) as { scope?: string };
  return (info.scope ?? '').split(/\s+/).includes(GMAIL_READONLY_SCOPE);
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    cache: 'no-store',
  });
  return response.ok;
}
