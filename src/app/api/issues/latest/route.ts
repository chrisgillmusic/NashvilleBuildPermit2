import { NextResponse } from 'next/server';
import { latestPublishedIssue } from '@/lib/issue/generate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const issue = await latestPublishedIssue();
  if (!issue) {
    return NextResponse.json({ issue: null });
  }
  return NextResponse.json({ issue });
}
