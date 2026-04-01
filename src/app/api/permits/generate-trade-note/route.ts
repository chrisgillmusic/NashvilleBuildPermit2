import { NextRequest, NextResponse } from 'next/server';
import { generateTradeNoteForProject, generateTradeNotesForProjects } from '@/lib/permits/live';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id?: string; ids?: string[]; trade?: string; bypassCache?: boolean };
  const id = body.id?.trim();
  const ids = Array.isArray(body.ids) ? body.ids : [];

  if (!body.trade?.trim()) {
    return NextResponse.json({ error: 'Trade is required.' }, { status: 400 });
  }

  if (ids.length) {
    const result = await generateTradeNotesForProjects(ids, body.trade, { bypassCache: body.bypassCache ?? false });
    return NextResponse.json(result);
  }

  if (!id) {
    return NextResponse.json({ error: 'Project id is required.' }, { status: 400 });
  }

  const result = await generateTradeNoteForProject(id, body.trade, { bypassCache: body.bypassCache ?? true });
  return NextResponse.json(result);
}
