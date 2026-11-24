import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildGoogleAuthorizationUrl,
  gmailOAuthConnectUrl,
  gmailOAuthOrigin,
  setOAuthStateCookie,
  validateGmailSessionEncryptionKey,
} from '@/lib/gmail-oauth-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const canonicalOrigin = gmailOAuthOrigin();
    if (request.nextUrl.origin !== canonicalOrigin) {
      return NextResponse.redirect(gmailOAuthConnectUrl(), 307);
    }
    validateGmailSessionEncryptionKey();
    const state = randomBytes(32).toString('base64url');
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state));
    setOAuthStateCookie(response, state);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start Gmail authorization.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
