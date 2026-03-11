import { NextRequest, NextResponse } from 'next/server';
import { runPermitSync } from '@/lib/arcgis/sync';
import { generateWeeklyIssue } from '@/lib/issue/generate';

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const syncResult = await runPermitSync({ mode: 'incremental-date', sinceDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2) });
  const issueResult = await generateWeeklyIssue(new Date());

  return NextResponse.json({ syncResult, issueResult });
}
