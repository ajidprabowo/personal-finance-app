import { NextRequest, NextResponse } from 'next/server';
import {
  GmailServerError,
  syncGmailMessagesServer,
  validateSyncFiltersInput,
} from '@/lib/gmail-server';
import { getGmailSession, refreshGmailAccessToken } from '@/lib/gmail-oauth-server';

export async function POST(req: NextRequest) {
  const session = getGmailSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Gmail is not connected.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  try {
    const filters = validateSyncFiltersInput(body);
    const token = await refreshGmailAccessToken(session);
    const result = await syncGmailMessagesServer(token, filters);
    return NextResponse.json(result);
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
