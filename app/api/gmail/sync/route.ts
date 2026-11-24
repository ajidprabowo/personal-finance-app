import { NextRequest, NextResponse } from 'next/server';
import {
  extractBearerTokenFromHeader,
  GmailServerError,
  syncGmailMessagesServer,
  validateSyncFiltersInput,
} from '@/lib/gmail-server';

export async function POST(req: NextRequest) {
  const token = extractBearerTokenFromHeader(req.headers.get('authorization'));
  if (!token) {
    return NextResponse.json(
      { error: 'Missing or invalid Bearer authorization header.', code: 'UNAUTHORIZED' },
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
      { error: 'Unexpected server error while syncing Gmail messages.', code: 'UPSTREAM_ERROR' },
      { status: 500 }
    );
  }
}
