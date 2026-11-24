import { NextRequest, NextResponse } from 'next/server';
import {
  extractBearerTokenFromHeader,
  GOOGLE_REVOKE_ENDPOINT,
} from '@/lib/gmail-server';

export async function POST(req: NextRequest) {
  const token = extractBearerTokenFromHeader(req.headers.get('authorization'));
  if (!token) {
    return NextResponse.json({ revoked: false });
  }

  try {
    const body = new URLSearchParams({ token });
    const res = await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      cache: 'no-store',
    });

    return NextResponse.json({ revoked: res.ok });
  } catch {
    return NextResponse.json({ revoked: false });
  }
}
