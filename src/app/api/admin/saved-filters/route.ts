import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function GET() {
  const items = await prisma.savedFilter.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 });
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const item = await prisma.savedFilter.create({
    data: {
      name: body.name || 'Saved filter',
      queryJson: (body.query || {}) as Prisma.InputJsonValue
    }
  });
  return NextResponse.json(item);
}
