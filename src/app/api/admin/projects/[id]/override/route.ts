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

  const body = await request.json();
  const scoreOverride = typeof body.scoreOverride === 'number' ? body.scoreOverride : null;

  const project = await prisma.project.update({
    where: { id: params.id },
    data: { scoreOverride }
  });

  return NextResponse.json(project);
}
