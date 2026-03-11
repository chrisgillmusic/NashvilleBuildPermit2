import type { AppSettings } from './settings';

type ClassificationInput = {
  permitTypeDescription?: string | null;
  permitSubtypeDescription?: string | null;
  purpose?: string | null;
  constructionCost?: number | null;
  zip?: string | null;
  councilDist?: string | null;
};

const RESIDENTIAL_TERMS = ['residential', 'single family', 'duplex', 'townhome', 'condo'];
const NASHVILLE_CITY_TERMS = ['NASHVILLE', 'METRO NASHVILLE', 'ANTIOCH', 'MADISON', 'HERMITAGE'];

export function isCommercialProject(input: ClassificationInput, settings: AppSettings): boolean {
  const type = (input.permitTypeDescription || '').toLowerCase();
  const subtype = (input.permitSubtypeDescription || '').toLowerCase();
  const purpose = (input.purpose || '').toLowerCase();

  if (RESIDENTIAL_TERMS.some((term) => type.includes(term) || subtype.includes(term) || purpose.includes(term))) {
    return false;
  }

  if (type.includes('commercial')) return true;

  return settings.includeInstitutionalSubtypes.some((term) => subtype.includes(term) || purpose.includes(term));
}

export function isTargetRange(constructionCost: number | null | undefined, settings: AppSettings): boolean {
  if (!constructionCost) return false;
  return constructionCost >= settings.minCost && constructionCost <= settings.maxCost;
}

export function isNashvilleArea(city?: string | null): boolean {
  if (!city) return true;
  return NASHVILLE_CITY_TERMS.includes(city.trim().toUpperCase());
}

export function isExcludedByKeyword(text: string, settings: AppSettings): boolean {
  const lower = text.toLowerCase();
  return settings.excludedKeywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function isIncludedByGeo(input: Pick<ClassificationInput, 'zip' | 'councilDist'>, settings: AppSettings): boolean {
  const zipMatch = !settings.includedZipCodes.length || settings.includedZipCodes.includes(input.zip || '');
  const districtMatch =
    !settings.includedCouncilDistricts.length || settings.includedCouncilDistricts.includes(input.councilDist || '');
  return zipMatch && districtMatch;
}
