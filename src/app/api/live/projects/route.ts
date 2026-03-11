import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get('zip');
  const subtype = searchParams.get('subtype');
  const min = searchParams.get('min') ? Number(searchParams.get('min')) : undefined;
  const max = searchParams.get('max') ? Number(searchParams.get('max')) : undefined;
  const phase = searchParams.get('phase');
  const query = searchParams.get('q');

  const where: Prisma.ProjectWhereInput = {
    isCommercial: true,
    isNashvilleArea: true,
    ...(zip ? { zip } : {}),
    ...(subtype ? { permitSubtypeDescription: { contains: subtype, mode: 'insensitive' } } : {}),
    ...(phase ? { phaseBucket: phase } : {}),
    ...(min || max
      ? {
          constructionCost: {
            ...(min ? { gte: min } : {}),
            ...(max ? { lte: max } : {})
          }
        }
      : {}),
    ...(query
      ? {
          OR: [
            { normalizedContactName: { contains: query.toUpperCase(), mode: 'insensitive' } },
            { permitSubtypeDescription: { contains: query, mode: 'insensitive' } },
            { purpose: { contains: query, mode: 'insensitive' } }
          ]
        }
      : {})
  };

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ scoreOverride: 'desc' }, { score: 'desc' }, { dateIssued: 'desc' }],
    take: 150
  });

  return NextResponse.json({ projects });
}
