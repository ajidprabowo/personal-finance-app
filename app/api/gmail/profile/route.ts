import { NextRequest, NextResponse } from 'next/server';
import {
  fetchGmailProfileServer,
  GmailServerError,
} from '@/lib/gmail-server';
import { getGmailSession, refreshGmailAccessToken } from '@/lib/gmail-oauth-server';

export async function GET(req: NextRequest) {
  const session = getGmailSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Gmail is not connected.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  try {
    const token = await refreshGmailAccessToken(session);
    const profile = await fetchGmailProfileServer(token);
    return NextResponse.json({
      emailAddress: profile.emailAddress,
      messagesTotal: profile.messagesTotal ?? null,
    });
  } catch (error) {
    if (error instanceof GmailServerError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: 'Gmail authorization has expired or could not be refreshed.', code: 'TOKEN_EXPIRED' },
      { status: 401 }
    );
  }
}
