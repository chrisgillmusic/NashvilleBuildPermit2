import { NextRequest, NextResponse } from 'next/server';
import { runTruthModeDbWriteTestForProject, runTruthModeTestForProject } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id?: string; trade?: string; mode?: 'pipeline' | 'db_write_test' };
  const id = body.id?.trim();

  if (!id) {
    return NextResponse.json({ error: 'Project id is required.' }, { status: 400 });
  }

  if (body.mode === 'db_write_test') {
    const result = await runTruthModeDbWriteTestForProject(id, body.trade || '');
    return NextResponse.json(result);
  }

  const result = await runTruthModeTestForProject(id, body.trade || '');
  return NextResponse.json(result);
}
