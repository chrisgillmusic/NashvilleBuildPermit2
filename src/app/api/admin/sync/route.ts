import { NextRequest, NextResponse } from 'next/server';
import { runPermitSync } from '@/lib/arcgis/sync';

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  return request.headers.get('x-admin-token') === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode as 'full' | 'incremental-date' | 'incremental-objectid' | undefined;

  const result = await runPermitSync({
    mode,
    sinceDate: body.sinceDate ? new Date(body.sinceDate) : undefined,
    minObjectId: body.minObjectId ? Number(body.minObjectId) : undefined
  });

  return NextResponse.json(result);
}
