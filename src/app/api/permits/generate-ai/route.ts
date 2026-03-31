import { NextRequest, NextResponse } from 'next/server';
import { generateSummariesForProjects } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { ids?: string[]; trade?: string; bypassCache?: boolean };
  const ids = Array.isArray(body.ids) ? body.ids : [];

  if (!ids.length) {
    return NextResponse.json({ error: 'At least one project id is required.' }, { status: 400 });
  }

  const result = await generateSummariesForProjects(ids, '', { bypassCache: body.bypassCache ?? false });
  return NextResponse.json(result);
}
