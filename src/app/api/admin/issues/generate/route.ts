import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyIssue } from '@/lib/issue/generate';

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
  const weekDate = body.weekDate ? new Date(body.weekDate) : new Date();
  const result = await generateWeeklyIssue(weekDate);
  return NextResponse.json(result);
}
