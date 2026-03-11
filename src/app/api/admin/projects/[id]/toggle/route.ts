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

  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const updated = await prisma.project.update({
    where: { id: params.id },
    data: { isIncludedInIssue: !project.isIncludedInIssue }
  });

  return NextResponse.json(updated);
}
