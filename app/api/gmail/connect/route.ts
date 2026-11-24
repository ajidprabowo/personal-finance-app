import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  buildGoogleAuthorizationUrl,
  setOAuthStateCookie,
} from '@/lib/gmail-oauth-server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const state = randomBytes(32).toString('base64url');
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state));
    setOAuthStateCookie(response, state);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start Gmail authorization.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
