import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  const items = await prisma.gcWatchlist.findMany({ include: { gcEntity: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const item = await prisma.gcWatchlist.create({
    data: {
      label: body.label || 'Watch',
      gcEntityId: body.gcEntityId,
      notes: body.notes || null
    }
  });
  return NextResponse.json(item);
}
