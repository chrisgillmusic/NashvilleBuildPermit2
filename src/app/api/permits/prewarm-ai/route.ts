import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json({
    disabled: true,
    reason: 'Background prewarm is disabled in verification mode.'
  });
}
