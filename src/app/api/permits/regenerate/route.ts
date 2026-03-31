import { NextRequest, NextResponse } from 'next/server';
import { regenerateProjectInterpretation } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id?: string; trade?: string };
  const id = body.id?.trim();

  if (!id) {
    return NextResponse.json({ error: 'Project id is required.' }, { status: 400 });
  }

  const result = await regenerateProjectInterpretation(id, body.trade || '');
  return NextResponse.json(result);
}
