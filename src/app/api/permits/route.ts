import { NextRequest, NextResponse } from 'next/server';
import { getDashboardPayload } from '@/lib/permits/live';
import type { DashboardFilters } from '@/lib/permits/types';

export const dynamic = 'force-dynamic';

function toNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const filters: Partial<DashboardFilters> = {
    minBudget: toNumber(searchParams.get('minBudget')),
    maxBudget: toNumber(searchParams.get('maxBudget')),
    dateFrom: searchParams.get('dateFrom') || undefined,
    dateTo: searchParams.get('dateTo') || undefined,
    permitType: searchParams.get('permitType') || undefined,
    neighborhood: searchParams.get('neighborhood') || undefined,
    contractorQuery: searchParams.get('contractorQuery') || undefined,
    sort: (searchParams.get('sort') as DashboardFilters['sort'] | null) || undefined
  };

  const payload = await getDashboardPayload(filters);
  return NextResponse.json(payload);
}
