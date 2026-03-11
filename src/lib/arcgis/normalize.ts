import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { differenceInCalendarDays } from 'date-fns';
import { isCommercialProject, isExcludedByKeyword, isIncludedByGeo, isNashvilleArea, isTargetRange } from '../classify';
import { computePhaseBucket } from '../phase';
import { scoreProject } from '../scoring/score-project';
import type { AppSettings } from '../settings';
import { normalizeName } from '../text/normalize';

function getAttr(attributes: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of candidates) {
    if (attributes[key] !== undefined && attributes[key] !== null) return attributes[key];
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str || null;
}

function toNumberValue(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toDateValue(value: unknown): Date | null {
  const num = toNumberValue(value);
  if (num && num > 1000000000) {
    return new Date(num);
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export type NormalizedPermit = {
  sourceObjectId: number;
  hash: string;
  rawJson: Prisma.InputJsonValue;
  sourceUpdatedAt: Date | null;
  project: Prisma.ProjectUncheckedCreateInput;
};

export function normalizePermitRecord(
  attributes: Record<string, unknown>,
  settings: AppSettings,
  repeatedGcActivityCount: number
): NormalizedPermit | null {
  const sourceObjectId = toNumberValue(getAttr(attributes, ['OBJECTID', 'ObjectId', 'ObjectID']));
  if (!sourceObjectId) return null;

  const permitTypeDescription = toStringValue(getAttr(attributes, ['Permit_Type_Description']));
  const permitSubtypeDescription = toStringValue(getAttr(attributes, ['Permit_SubType_Description', 'Permit_Subtype_Description']));
  const purpose = toStringValue(getAttr(attributes, ['Purpose', 'Permit_Purpose']));
  const contactRaw = toStringValue(getAttr(attributes, ['Contact', 'Contractor', 'Applicant']));
  const normalizedContactName = normalizeName(contactRaw);
  const constructionCost = toNumberValue(getAttr(attributes, ['Construction_Cost', 'Estimated_Construction_Cost']));
  const city = toStringValue(getAttr(attributes, ['City']));
  const zip = toStringValue(getAttr(attributes, ['Zip', 'Zip_Code']));
  const councilDist = toStringValue(getAttr(attributes, ['Council_Dist']));
  const dateIssued = toDateValue(getAttr(attributes, ['Date_Issued']));
  const ageDays = dateIssued ? differenceInCalendarDays(new Date(), dateIssued) : 999;
  const phaseBucket = computePhaseBucket(dateIssued);

  const descriptor = `${permitTypeDescription || ''} ${permitSubtypeDescription || ''} ${purpose || ''}`;

  const isCommercial = isCommercialProject(
    {
      permitTypeDescription,
      permitSubtypeDescription,
      purpose,
      constructionCost,
      zip,
      councilDist
    },
    settings
  );
  const targetRange = isTargetRange(constructionCost, settings);
  const nashvilleArea = isNashvilleArea(city) && isIncludedByGeo({ zip, councilDist }, settings);
  const excludedKeyword = isExcludedByKeyword(descriptor, settings);

  const scoreBreakdown = scoreProject({
    constructionCost,
    minCost: settings.minCost,
    maxCost: settings.maxCost,
    permitSubtypeDescription,
    purpose,
    hasUsableContact: Boolean(normalizedContactName),
    repeatedGcActivityCount,
    zip,
    phaseBucket,
    ageDays
  });

  const tradeTags = deriveTradeTags(phaseBucket, descriptor);

  const project: Prisma.ProjectUncheckedCreateInput = {
    sourceObjectId,
    permitNumber: toStringValue(getAttr(attributes, ['Permit_No', 'Permit_Number'])),
    permitTypeDescription,
    permitSubtypeDescription,
    parcel: toStringValue(getAttr(attributes, ['Parcel'])),
    dateEntered: toDateValue(getAttr(attributes, ['Date_Entered'])),
    dateIssued,
    constructionCost: constructionCost as any,
    address: toStringValue(getAttr(attributes, ['Address', 'Address_Full'])),
    city,
    state: toStringValue(getAttr(attributes, ['State'])),
    zip,
    subdivisionLot: toStringValue(getAttr(attributes, ['Subdivision_Lot'])),
    contactRaw,
    normalizedContactName,
    purpose,
    councilDist,
    censusTract: toStringValue(getAttr(attributes, ['Census_Tract'])),
    lon: toNumberValue(getAttr(attributes, ['lon', 'Longitude', 'X'])),
    lat: toNumberValue(getAttr(attributes, ['lat', 'Latitude', 'Y'])),
    phaseBucket,
    score: scoreBreakdown.total,
    scoreBreakdown: scoreBreakdown as Prisma.InputJsonValue,
    tradeTags: tradeTags as Prisma.InputJsonValue,
    likelyStageNote: deriveLikelyStageNote(phaseBucket),
    isCommercial,
    isTargetRange: targetRange,
    isNashvilleArea: nashvilleArea,
    isIncludedInIssue: isCommercial && targetRange && nashvilleArea && !excludedKeyword
  };

  return {
    sourceObjectId,
    hash: crypto.createHash('sha256').update(JSON.stringify(attributes)).digest('hex'),
    rawJson: attributes as Prisma.InputJsonValue,
    sourceUpdatedAt: toDateValue(getAttr(attributes, ['LastEditDate', 'EditDate'])),
    project
  };
}

function deriveTradeTags(phase: string, descriptor: string): string[] {
  const lower = descriptor.toLowerCase();
  const tags = new Set<string>();
  if (lower.includes('office')) tags.add('office-interiors');
  if (lower.includes('medical') || lower.includes('hospital')) tags.add('healthcare');
  if (lower.includes('restaurant')) tags.add('restaurant');
  if (lower.includes('warehouse')) tags.add('industrial');
  if (lower.includes('retail')) tags.add('retail');

  if (phase === 'ON DECK') {
    tags.add('mep-coordination');
    tags.add('framing');
  }
  if (phase === 'IN MOTION') {
    tags.add('rough-ins');
    tags.add('electrical');
    tags.add('plumbing');
    tags.add('hvac');
    tags.add('fire-protection');
  }
  if (phase === 'CLOSING OUT') {
    tags.add('flooring');
    tags.add('paint');
    tags.add('finish-carpentry');
    tags.add('lighting-trim');
    tags.add('specialty-scopes');
  }

  return [...tags];
}

function deriveLikelyStageNote(phase: string): string {
  if (phase === 'ON DECK') {
    return 'Early coordination window; MEP, framing, and structural planning-sensitive trades should position now.';
  }
  if (phase === 'IN MOTION') {
    return 'Trade pricing and rough-in conversations are likely active across core MEP and framing scopes.';
  }
  if (phase === 'CLOSING OUT') {
    return 'Finishing trades, punch-list support, and specialty scope backfill opportunities are most likely.';
  }
  return 'Outside the primary issue window.';
}
