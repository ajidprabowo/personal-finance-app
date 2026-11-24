import { NextRequest, NextResponse } from 'next/server';
import {
  extractBearerTokenFromHeader,
  fetchGmailProfileServer,
  GmailServerError,
} from '@/lib/gmail-server';

export async function GET(req: NextRequest) {
  const token = extractBearerTokenFromHeader(req.headers.get('authorization'));
  if (!token) {
    return NextResponse.json(
      { error: 'Missing or invalid Bearer authorization header.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  try {
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
      { error: 'Failed to verify Gmail profile.', code: 'UPSTREAM_ERROR' },
      { status: 500 }
    );
  }
}
