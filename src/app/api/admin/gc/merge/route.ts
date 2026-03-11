import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  return request.headers.get('x-admin-token') === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sourceGcEntityId, targetGcEntityId } = await request.json();
  if (!sourceGcEntityId || !targetGcEntityId || sourceGcEntityId === targetGcEntityId) {
    return NextResponse.json({ error: 'Invalid merge payload' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const source = await tx.gcEntity.findUnique({ where: { id: sourceGcEntityId } });
    const target = await tx.gcEntity.findUnique({ where: { id: targetGcEntityId } });
    if (!source || !target) {
      throw new Error('GC entity not found');
    }

    await tx.projectGcLink.updateMany({
      where: { gcEntityId: sourceGcEntityId },
      data: { gcEntityId: targetGcEntityId }
    });

    const mergedAliases = [...new Set([...(source.aliases as string[]), ...(target.aliases as string[]), source.canonicalName])];

    await tx.gcEntity.update({
      where: { id: targetGcEntityId },
      data: {
        aliases: mergedAliases as Prisma.InputJsonValue,
        notes: [target.notes, `Merged ${source.canonicalName} on ${new Date().toISOString().slice(0, 10)}`]
          .filter(Boolean)
          .join('\n')
      }
    });

    await tx.gcEntity.delete({ where: { id: sourceGcEntityId } });
  });

  return NextResponse.json({ ok: true });
}
