import { NextRequest, NextResponse } from 'next/server';
import { fetchGmailProfileServer } from '@/lib/gmail-server';
import {
  clearOAuthStateCookie,
  exchangeAuthorizationCode,
  gmailImportReturnUrl,
  setGmailSessionCookie,
  validateOAuthState,
  verifyGrantedGmailScope,
} from '@/lib/gmail-oauth-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (request.nextUrl.searchParams.has('error') || !validateOAuthState(request, state) || !code) {
    const response = NextResponse.redirect(gmailImportReturnUrl('error'));
    clearOAuthStateCookie(response);
    return response;
  }

  try {
    const tokens = await exchangeAuthorizationCode(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return the access and refresh tokens required for Gmail.');
    }
    if (!(await verifyGrantedGmailScope(tokens.access_token))) {
      throw new Error('Gmail read-only permission was not granted.');
    }
    const profile = await fetchGmailProfileServer(tokens.access_token);
    const response = NextResponse.redirect(gmailImportReturnUrl('connected'));
    setGmailSessionCookie(response, {
      refreshToken: tokens.refresh_token,
      emailAddress: profile.emailAddress,
    });
    clearOAuthStateCookie(response);
    return response;
  } catch {
    const response = NextResponse.redirect(gmailImportReturnUrl('error'));
    clearOAuthStateCookie(response);
    return response;
  }
}
