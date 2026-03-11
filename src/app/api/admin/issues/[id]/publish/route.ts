import { WeeklyIssueStatus } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  return request.headers.get('x-admin-token') === expected;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const issue = await prisma.weeklyIssue.update({
    where: { id: params.id },
    data: {
      status: WeeklyIssueStatus.published,
      publishedAt: new Date()
    }
  });

  return NextResponse.json({ id: issue.id, status: issue.status, publishedAt: issue.publishedAt });
}
