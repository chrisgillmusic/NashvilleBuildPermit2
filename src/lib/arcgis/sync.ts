import { Prisma, SyncStatus } from '@prisma/client';
import slugify from 'slugify';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { normalizeName } from '../text/normalize';
import { chunkObjectIds, fetchCount, fetchFeaturesByObjectIds, fetchFeaturesByOffset, fetchMetadata, fetchObjectIds } from './client';
import { normalizePermitRecord } from './normalize';

type SyncMode = 'full' | 'incremental-date' | 'incremental-objectid';

type SyncOptions = {
  mode?: SyncMode;
  sinceDate?: Date;
  minObjectId?: number;
};

type SyncResult = {
  batchId: string;
  idsFetched: number;
  recordsFetched: number;
  recordsProcessed: number;
  failedBatches: string[];
};

function buildWhereClause(options: SyncOptions): string {
  if (options.mode === 'incremental-date' && options.sinceDate) {
    return `Date_Issued >= DATE '${options.sinceDate.toISOString().slice(0, 10)}'`;
  }
  if (options.mode === 'incremental-objectid' && options.minObjectId) {
    return `OBJECTID > ${Math.floor(options.minObjectId)}`;
  }
  return '1=1';
}

async function upsertGcLink(
  tx: Prisma.TransactionClient,
  projectId: string,
  normalizedContactName: string | null,
  contactRaw: string | null
): Promise<void> {
  if (!normalizedContactName) return;

  const slug = slugify(normalizedContactName, { lower: true, strict: true }) || `gc-${normalizedContactName.toLowerCase()}`;
  const aliases = contactRaw && contactRaw !== normalizedContactName ? [contactRaw] : [];

  const existing = await tx.gcEntity.findUnique({ where: { slug } });
  const existingAliases = ((existing?.aliases as string[] | undefined) || []) as string[];
  const mergedAliases = [...new Set([...existingAliases, normalizedContactName, ...aliases])];

  const entity = await tx.gcEntity.upsert({
    where: { slug },
    update: {
      aliases: mergedAliases as Prisma.InputJsonValue
    },
    create: {
      canonicalName: normalizedContactName,
      slug,
      aliases: mergedAliases as Prisma.InputJsonValue
    }
  });

  await tx.projectGcLink.upsert({
    where: {
      projectId_gcEntityId_sourceRole: {
        projectId,
        gcEntityId: entity.id,
        sourceRole: 'contact'
      }
    },
    update: { confidenceScore: 0.8 },
    create: {
      projectId,
      gcEntityId: entity.id,
      sourceRole: 'contact',
      confidenceScore: 0.8
    }
  });
}

async function repeatedGcCount(normalizedContactName: string | null): Promise<number> {
  if (!normalizedContactName) return 0;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  return prisma.project.count({
    where: {
      normalizedContactName,
      dateIssued: { gte: ninetyDaysAgo }
    }
  });
}

export async function runPermitSync(options: SyncOptions = {}): Promise<SyncResult> {
  const settings = await getSettings();
  const whereClause = buildWhereClause(options);

  const batch = await prisma.syncBatch.create({
    data: {
      mode: options.mode || 'full',
      status: SyncStatus.started,
      whereClause
    }
  });

  let idsFetched = 0;
  let recordsFetched = 0;
  let recordsProcessed = 0;
  const failedBatches: string[] = [];

  try {
    await fetchMetadata().catch((error) => {
      console.warn('ArcGIS metadata preflight failed', error);
    });

    const totalCount = await fetchCount(whereClause);
    let objectIds = await fetchObjectIds(whereClause);

    if (!objectIds.length && totalCount > 0) {
      let offset = 0;
      const fallbackIds: number[] = [];
      while (true) {
        const rows = await fetchFeaturesByOffset(whereClause, offset, 500);
        if (!rows.length) break;
        for (const row of rows) {
          const id = Number((row.attributes.OBJECTID || row.attributes.ObjectID || row.attributes.ObjectId) as any);
          if (Number.isFinite(id)) fallbackIds.push(id);
        }
        offset += 500;
      }
      objectIds = fallbackIds;
    }

    idsFetched = objectIds.length;

    const chunks = chunkObjectIds(objectIds);

    for (const chunk of chunks) {
      try {
        const features = await fetchFeaturesByObjectIds(chunk);
        recordsFetched += features.length;

        for (const feature of features) {
          const attributes = feature.attributes || {};
          const normalizedContactName = normalizeName((attributes.Contact || attributes.Contractor || attributes.Applicant) as string);
          const repeatCount = await repeatedGcCount(normalizedContactName);
          const normalized = normalizePermitRecord(attributes, settings, repeatCount);
          if (!normalized) continue;

          await prisma.$transaction(async (tx) => {
            await tx.rawPermit.create({
              data: {
                sourceObjectId: normalized.sourceObjectId,
                rawJson: normalized.rawJson,
                sourceUpdatedAt: normalized.sourceUpdatedAt,
                hash: normalized.hash,
                syncBatchId: batch.id
              }
            });

            const project = await tx.project.upsert({
              where: { sourceObjectId: normalized.sourceObjectId },
              update: {
                ...normalized.project,
                updatedAt: new Date()
              },
              create: normalized.project
            });

            await upsertGcLink(
              tx,
              project.id,
              normalized.project.normalizedContactName || null,
              normalized.project.contactRaw || null
            );
          });
          recordsProcessed += 1;
        }
      } catch (error) {
        console.error('Failed chunk', chunk[0], chunk[chunk.length - 1], error);
        failedBatches.push(`${chunk[0]}-${chunk[chunk.length - 1]}`);
      }
    }

    await prisma.syncBatch.update({
      where: { id: batch.id },
      data: {
        status: failedBatches.length ? SyncStatus.partial : SyncStatus.success,
        finishedAt: new Date(),
        idsFetched,
        recordsFetched,
        recordsProcessed,
        failedBatches: failedBatches as Prisma.InputJsonValue
      }
    });

    return { batchId: batch.id, idsFetched, recordsFetched, recordsProcessed, failedBatches };
  } catch (error) {
    await prisma.syncBatch.update({
      where: { id: batch.id },
      data: {
        status: SyncStatus.failed,
        finishedAt: new Date(),
        idsFetched,
        recordsFetched,
        recordsProcessed,
        failedBatches: failedBatches as Prisma.InputJsonValue,
        errorSummary: error instanceof Error ? error.message : 'Unknown sync error'
      }
    });

    throw error;
  }
}
