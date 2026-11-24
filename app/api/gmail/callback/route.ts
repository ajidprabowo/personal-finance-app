import { NextRequest, NextResponse } from 'next/server';
import { fetchGmailProfileServer } from '@/lib/gmail-server';
import {
  clearOAuthStateCookie,
  exchangeAuthorizationCode,
  GmailSessionPersistenceError,
  getGmailSession,
  gmailImportReturnUrl,
  gmailOAuthOrigin,
  setGmailSessionCookie,
  validateOAuthState,
  verifyGrantedGmailScope,
} from '@/lib/gmail-oauth-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let stage = 'validate_callback';
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const validState = validateOAuthState(request, state);
  const deniedByGoogle = request.nextUrl.searchParams.has('error');
  if (
    request.nextUrl.origin !== gmailOAuthOrigin() ||
    deniedByGoogle ||
    !validState ||
    !code
  ) {
    const reason = request.nextUrl.origin !== gmailOAuthOrigin()
      ? 'origin_mismatch'
      : deniedByGoogle
        ? 'google_denied'
        : !validState
          ? 'state_mismatch'
          : 'missing_code';
    console.warn('[gmail-oauth] callback rejected', {
      reason,
    });
    const response = NextResponse.redirect(gmailImportReturnUrl('error'));
    if (validState && state) clearOAuthStateCookie(response, state);
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
    if (state) clearOAuthStateCookie(response, state);
    return response;
  } catch (error) {
    console.error('[gmail-oauth] callback failed', {
      stage,
      code: error instanceof GmailSessionPersistenceError
        ? error.code
        : 'oauth_callback_error',
    });
    const response = NextResponse.redirect(gmailImportReturnUrl('error'));
    if (state) clearOAuthStateCookie(response, state);
    return response;
  }
}
