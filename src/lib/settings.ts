import { z } from 'zod';
import { prisma } from './db';

export const appSettingsSchema = z.object({
  minCost: z.number().default(250000),
  maxCost: z.number().default(2000000),
  rollingWindowDays: z.number().int().positive().default(90),
  targetPermitTypes: z.array(z.string()).default(['Commercial']),
  excludedSubtypes: z.array(z.string()).default([]),
  excludedKeywords: z.array(z.string()).default(['single family', 'duplex', 'townhome', 'residential']),
  includedZipCodes: z.array(z.string()).default([]),
  includedCouncilDistricts: z.array(z.string()).default([]),
  includeInstitutionalSubtypes: z.array(z.string()).default([
    'hospital',
    'medical office',
    'hotel',
    'office',
    'warehouse',
    'restaurant',
    'retail',
    'financial institution'
  ])
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultSettings: AppSettings = appSettingsSchema.parse({});

const SETTINGS_KEY = 'core';

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) {
    await prisma.appSetting.create({ data: { key: SETTINGS_KEY, value: defaultSettings } });
    return defaultSettings;
  }
  return appSettingsSchema.parse(row.value);
}

export async function updateSettings(input: unknown): Promise<AppSettings> {
  const parsed = appSettingsSchema.parse(input);
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: parsed },
    create: { key: SETTINGS_KEY, value: parsed }
  });
  return parsed;
}
