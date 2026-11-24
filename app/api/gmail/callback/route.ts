import { NextRequest, NextResponse } from 'next/server';
import { fetchGmailProfileServer } from '@/lib/gmail-server';
import {
  clearOAuthStateCookie,
  exchangeAuthorizationCode,
  getGmailSession,
  gmailImportReturnUrl,
  setGmailSessionCookie,
  validateOAuthState,
  verifyGrantedGmailScope,
} from '@/lib/gmail-oauth-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let stage = 'validate_callback';
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (request.nextUrl.searchParams.has('error') || !validateOAuthState(request, state) || !code) {
    console.warn('[gmail-oauth] callback rejected', {
      reason: request.nextUrl.searchParams.has('error')
        ? 'google_denied'
        : !validateOAuthState(request, state)
          ? 'state_mismatch'
          : 'missing_code',
    });
    const response = NextResponse.redirect(gmailImportReturnUrl('error'));
    clearOAuthStateCookie(response);
    return response;
  }

  try {
    stage = 'exchange_code';
    const tokens = await exchangeAuthorizationCode(code);
    if (!tokens.access_token) throw new Error('Google did not return an access token.');
    stage = 'verify_scope';
    if (!(await verifyGrantedGmailScope(tokens.access_token))) {
      stage = 'gmail_scope_not_granted';
      throw new Error('Required Gmail permission was not granted.');
    }
    stage = 'verify_gmail_profile';
    const profile = await fetchGmailProfileServer(tokens.access_token);
    const existingSession = getGmailSession(request);
    const refreshToken =
      tokens.refresh_token ??
      (existingSession?.emailAddress === profile.emailAddress
        ? existingSession.refreshToken
        : null);
    if (!refreshToken) {
      stage = 'missing_refresh_token';
      throw new Error('Google did not return a refresh token for this Gmail account.');
    }
    const response = NextResponse.redirect(gmailImportReturnUrl('connected'));
    stage = 'persist_session_cookie';
    setGmailSessionCookie(response, {
      refreshToken,
      emailAddress: profile.emailAddress,
    });
    clearOAuthStateCookie(response);
    return response;
  } catch (error) {
    console.error('[gmail-oauth] callback failed', {
      stage,
      code:
        typeof error === 'object' && error !== null && 'code' in error &&
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'oauth_callback_error',
    });
    const response = NextResponse.redirect(gmailImportReturnUrl('error'));
    clearOAuthStateCookie(response);
    return response;
  }
}
