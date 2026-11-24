import { NextRequest, NextResponse } from 'next/server';
import {
  clearGmailSessionCookie,
  getGmailSession,
  revokeGoogleToken,
} from '@/lib/gmail-oauth-server';

export async function POST(req: NextRequest) {
  const session = getGmailSession(req);
  let revoked = false;
  try {
    if (session) revoked = await revokeGoogleToken(session.refreshToken);
  } catch { /* Clear the local session even when Google revocation is unavailable. */ }
  const response = NextResponse.json({ revoked });
  clearGmailSessionCookie(response);
  return response;
}
