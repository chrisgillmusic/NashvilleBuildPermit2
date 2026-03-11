import { Prisma, WeeklyIssueStatus } from '@prisma/client';
import { endOfWeek, startOfWeek, subDays } from 'date-fns';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { cleanPurposeSummary } from '../text/normalize';
import { DEFAULT_INTRO, DEFAULT_OUTRO } from './constants';

const SECTION_CAPS = {
  'ON DECK': 8,
  'IN MOTION': 15,
  'CLOSING OUT': 8
} as const;

function profileNoteForSubtype(subtype: string): string {
  const value = subtype.toLowerCase();
  if (value.includes('medical') || value.includes('hospital')) return 'Active in healthcare and institutional interiors.';
  if (value.includes('retail') || value.includes('shell')) return 'Multiple retail and shell permits in the current cycle.';
  if (value.includes('office') || value.includes('tenant')) return 'Strong concentration in office and tenant improvement work.';
  return 'Steady permit activity across multiple commercial project types.';
}

export async function generateWeeklyIssue(weekDate = new Date()): Promise<{ issueId: string; projectCount: number }> {
  const settings = await getSettings();
  const weekStartDate = startOfWeek(weekDate, { weekStartsOn: 1 });
  const lookbackStart = subDays(endOfWeek(weekStartDate, { weekStartsOn: 1 }), settings.rollingWindowDays);

  const projects = await prisma.project.findMany({
    where: {
      isIncludedInIssue: true,
      isCommercial: true,
      isTargetRange: true,
      isNashvilleArea: true,
      dateIssued: { gte: lookbackStart },
      phaseBucket: { in: ['ON DECK', 'IN MOTION', 'CLOSING OUT'] }
    },
    orderBy: [{ scoreOverride: 'desc' }, { score: 'desc' }, { constructionCost: 'desc' }]
  });

  const bySection = {
    'ON DECK': projects
      .filter((p) => p.phaseBucket === 'ON DECK')
      .slice(0, SECTION_CAPS['ON DECK'])
      .sort((a, b) => Number(b.constructionCost || 0) - Number(a.constructionCost || 0)),
    'IN MOTION': projects
      .filter((p) => p.phaseBucket === 'IN MOTION')
      .slice(0, SECTION_CAPS['IN MOTION'])
      .sort((a, b) => Number(b.constructionCost || 0) - Number(a.constructionCost || 0)),
    'CLOSING OUT': projects
      .filter((p) => p.phaseBucket === 'CLOSING OUT')
      .slice(0, SECTION_CAPS['CLOSING OUT'])
      .sort((a, b) => Number(b.constructionCost || 0) - Number(a.constructionCost || 0))
  };

  const issue = await prisma.weeklyIssue.upsert({
    where: { weekStartDate },
    update: {
      title: `Nashville Build Insider - Week of ${weekStartDate.toLocaleDateString()}`,
      introText: DEFAULT_INTRO,
      outroText: DEFAULT_OUTRO,
      generatedAt: new Date(),
      status: WeeklyIssueStatus.draft
    },
    create: {
      weekStartDate,
      title: `Nashville Build Insider - Week of ${weekStartDate.toLocaleDateString()}`,
      introText: DEFAULT_INTRO,
      outroText: DEFAULT_OUTRO,
      status: WeeklyIssueStatus.draft
    }
  });

  await prisma.weeklyIssueProject.deleteMany({ where: { weeklyIssueId: issue.id } });

  for (const sectionName of ['ON DECK', 'IN MOTION', 'CLOSING OUT'] as const) {
    const rows = bySection[sectionName];
    for (let i = 0; i < rows.length; i += 1) {
      const project = rows[i];
      await prisma.weeklyIssueProject.create({
        data: {
          weeklyIssueId: issue.id,
          projectId: project.id,
          sectionName,
          sortOrder: i,
          displayNote: cleanPurposeSummary(project.purpose),
          customTradeNote: project.likelyStageNote
        }
      });
    }
  }

  const hotGcRows = await prisma.projectGcLink.findMany({
    where: {
      project: {
        dateIssued: { gte: lookbackStart },
        isIncludedInIssue: true,
        isCommercial: true,
        isTargetRange: true,
        isNashvilleArea: true
      }
    },
    include: {
      gcEntity: true,
      project: true
    }
  });

  const grouped = new Map<string, { entityId: string; total: number; count: number; dates: Date[]; subtypeVotes: Record<string, number> }>();

  for (const row of hotGcRows) {
    const entry = grouped.get(row.gcEntityId) || {
      entityId: row.gcEntityId,
      total: 0,
      count: 0,
      dates: [],
      subtypeVotes: {}
    };

    const cost = Number(row.project.constructionCost || 0);
    entry.total += cost;
    entry.count += 1;
    if (row.project.dateIssued) entry.dates.push(row.project.dateIssued);
    const subtype = row.project.permitSubtypeDescription || 'Other';
    entry.subtypeVotes[subtype] = (entry.subtypeVotes[subtype] || 0) + 1;
    grouped.set(row.gcEntityId, entry);
  }

  for (const entry of grouped.values()) {
    const dominantSubtype = Object.entries(entry.subtypeVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Other';
    const avg = entry.count ? entry.total / entry.count : 0;
    const mostRecent = entry.dates.sort((a, b) => b.getTime() - a.getTime())[0] || null;

    await prisma.gcActivitySnapshot.upsert({
      where: {
        weekStartDate_gcEntityId: {
          weekStartDate,
          gcEntityId: entry.entityId
        }
      },
      update: {
        projectCount90d: entry.count,
        totalValuation90d: entry.total,
        avgProjectSize: avg,
        mostRecentPermitDate: mostRecent,
        dominantSubtype,
        profileNote: profileNoteForSubtype(dominantSubtype),
        generatedAt: new Date()
      },
      create: {
        weekStartDate,
        gcEntityId: entry.entityId,
        projectCount90d: entry.count,
        totalValuation90d: entry.total,
        avgProjectSize: avg,
        mostRecentPermitDate: mostRecent,
        dominantSubtype,
        profileNote: profileNoteForSubtype(dominantSubtype)
      }
    });
  }

  return { issueId: issue.id, projectCount: projects.length };
}

export async function latestPublishedIssue() {
  return prisma.weeklyIssue.findFirst({
    where: { status: WeeklyIssueStatus.published },
    orderBy: { weekStartDate: 'desc' },
    include: {
      projects: {
        include: { project: true },
        orderBy: [{ sectionName: 'asc' }, { sortOrder: 'asc' }]
      }
    }
  });
}

export async function getIssueWithHotGcs(issueId: string) {
  const issue = await prisma.weeklyIssue.findUnique({
    where: { id: issueId },
    include: {
      projects: {
        include: {
          project: {
            include: {
              gcLinks: { include: { gcEntity: true } }
            }
          }
        },
        orderBy: [{ sectionName: 'asc' }, { sortOrder: 'asc' }]
      }
    }
  });

  if (!issue) return null;

  const snapshots = await prisma.gcActivitySnapshot.findMany({
    where: { weekStartDate: issue.weekStartDate },
    include: { gcEntity: true },
    orderBy: [{ projectCount90d: 'desc' }, { totalValuation90d: 'desc' }],
    take: 12
  });

  return { issue, snapshots };
}
