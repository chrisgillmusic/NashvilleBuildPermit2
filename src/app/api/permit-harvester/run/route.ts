import { NextRequest, NextResponse } from 'next/server';
import { runPermitHarvester } from '@/lib/permit-harvester/run';
import type { PermitHarvesterFilters } from '@/lib/permit-harvester/types';

export const dynamic = 'force-dynamic';

type RunRequestBody = {
  cityId?: string;
  filters?: Partial<PermitHarvesterFilters>;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as RunRequestBody;
  const cityId = body.cityId || 'jacksonville-fl';

  const result = await runPermitHarvester(cityId, body.filters);
  return NextResponse.json(result, {
    status: result.error ? 502 : 200
  });
}
