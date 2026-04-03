import type { Metadata } from 'next';
import { PermitHarvesterApp } from '@/components/permit-harvester-app';
import { getCitySourceSummaries, getDefaultCityId } from '@/lib/permit-harvester/sources';

export const metadata: Metadata = {
  title: 'Permit Harvester',
  description: 'Local permit ingestion and export tool.'
};

export default function PermitHarvesterPage() {
  const sources = getCitySourceSummaries();
  const initialCityId = getDefaultCityId();

  return <PermitHarvesterApp sources={sources} initialCityId={initialCityId} />;
}
